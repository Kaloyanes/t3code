import {
  CommandId,
  IsoDateTime,
  IssueLinkedWork,
  PositiveInt,
  ProjectId,
  ThreadId,
  type OrchestrationProjectShell,
  type ThreadPullRequestKey,
  type ThreadPullRequestSnapshot,
  type ThreadPullRequestStack,
  type WorktreePullRequestLink,
  type WorktreePullRequestLinkSource,
} from "@t3tools/contracts";
import {
  normalizeThreadPullRequestKey,
  threadPullRequestKeysEqual,
} from "@t3tools/shared/threadPullRequests";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import { toPersistenceSqlError } from "../persistence/Errors.ts";
import * as WorktreePullRequestRows from "../persistence/ProjectionProjectWorktreePullRequests.ts";

export interface ProjectWorktreeLinkSet {
  readonly worktreePullRequests: ReadonlyArray<WorktreePullRequestLink>;
  readonly worktreeIssues: ReadonlyArray<IssueLinkedWork>;
}

export interface WorktreePullRequestTarget extends ThreadPullRequestKey {
  readonly projectId: ProjectId;
  readonly worktreePath: string | null;
}

/**
 * Pull requests and issues linked to a worktree rather than one thread. They live
 * outside the orchestration event log and reach clients as project shell fields,
 * so every change is published for the shell stream to refresh.
 */
export class ProjectWorktreeLinks extends Context.Service<
  ProjectWorktreeLinks,
  {
    readonly forProjects: (
      projectIds?: ReadonlyArray<ProjectId>,
    ) => Effect.Effect<ReadonlyMap<ProjectId, ProjectWorktreeLinkSet>, ProjectionRepositoryError>;
    /** Adds the worktree link fields to project shells; failures leave shells unchanged. */
    readonly enrichShells: <P extends OrchestrationProjectShell>(
      projects: ReadonlyArray<P>,
    ) => Effect.Effect<ReadonlyArray<P>>;
    readonly listPullRequests: (
      projectId?: ProjectId,
    ) => Effect.Effect<ReadonlyArray<WorktreePullRequestLink>, ProjectionRepositoryError>;
    /** False when the pull request was already linked to that worktree. */
    readonly linkPullRequest: (
      input: WorktreePullRequestTarget & {
        readonly url: string;
        readonly source: WorktreePullRequestLinkSource;
      },
    ) => Effect.Effect<boolean, ProjectionRepositoryError>;
    /**
     * Removes the worktree link and the matching created/stack links its threads
     * still carry, so neither the worktree nor its threads show it again.
     */
    readonly unlinkPullRequest: (
      input: WorktreePullRequestTarget,
    ) => Effect.Effect<boolean, ProjectionRepositoryError>;
    readonly syncPullRequest: (
      input: WorktreePullRequestTarget & {
        readonly snapshot: ThreadPullRequestSnapshot;
        readonly stack: ThreadPullRequestStack | null;
      },
    ) => Effect.Effect<void, ProjectionRepositoryError>;
    /** Announce an issue-link change made directly in storage. */
    readonly publish: (projectId: ProjectId) => Effect.Effect<void>;
    readonly subscribeChanges: Effect.Effect<Stream.Stream<ProjectId>, never, Scope.Scope>;
  }
>()("t3/project/ProjectWorktreeLinks") {}

const IssueLinkRow = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  host: Schema.String,
  repository: Schema.String,
  number: PositiveInt,
  source: Schema.String,
  linkedAt: IsoDateTime,
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  state: Schema.NullOr(Schema.String),
});

function toIssueLinkedWork(row: typeof IssueLinkRow.Type): IssueLinkedWork {
  return {
    issue: { provider: "github", host: row.host, repository: row.repository, number: row.number },
    threadId: row.threadId,
    projectId: row.projectId,
    branch: row.branch === "" ? null : row.branch,
    worktreePath: row.worktreePath === "" ? null : row.worktreePath,
    linkedAt: row.linkedAt,
    source: row.source === "created" || row.source === "agent" ? row.source : "manual",
    ...(row.state === "open" || row.state === "closed" ? { state: row.state } : {}),
  };
}

function sameTarget(link: WorktreePullRequestLink, target: WorktreePullRequestTarget): boolean {
  return link.worktreePath === target.worktreePath && threadPullRequestKeysEqual(link, target);
}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* WorktreePullRequestRows.ProjectionProjectWorktreePullRequestRepository;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const changes = yield* PubSub.unbounded<ProjectId>();
  // Read-modify-write per project; one lock keeps concurrent links from racing.
  const writeLock = yield* Semaphore.make(1);

  const listIssueRows = SqlSchema.findAll({
    Request: Schema.Struct({ projectIds: Schema.optional(Schema.Array(ProjectId)) }),
    Result: IssueLinkRow,
    execute: ({ projectIds }) => sql`
      SELECT
        thread_id AS "threadId",
        project_id AS "projectId",
        host,
        repository,
        number,
        source,
        linked_at AS "linkedAt",
        branch,
        worktree_path AS "worktreePath",
        state
      FROM projection_issue_links
      WHERE detached_at IS NULL
      ${projectIds === undefined ? sql`` : sql`AND ${sql.in("project_id", projectIds)}`}
      ORDER BY project_id ASC, linked_at ASC, number ASC
    `,
  });

  const forProjects = Effect.fn("ProjectWorktreeLinks.forProjects")(function* (
    projectIds?: ReadonlyArray<ProjectId>,
  ) {
    if (projectIds !== undefined && projectIds.length === 0) return new Map();
    const [pullRequests, issues] = yield* Effect.all([
      rows.list({}),
      listIssueRows(projectIds === undefined ? {} : { projectIds }).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectWorktreeLinks.forProjects:issues")),
      ),
    ]);
    const wanted = projectIds === undefined ? null : new Set(projectIds);
    const byProject = new Map<
      ProjectId,
      { worktreePullRequests: WorktreePullRequestLink[]; worktreeIssues: IssueLinkedWork[] }
    >();
    const entry = (projectId: ProjectId) => {
      let value = byProject.get(projectId);
      if (value === undefined) {
        value = { worktreePullRequests: [], worktreeIssues: [] };
        byProject.set(projectId, value);
      }
      return value;
    };
    for (const link of pullRequests) {
      if (wanted === null || wanted.has(link.projectId))
        entry(link.projectId).worktreePullRequests.push(link);
    }
    for (const row of issues) entry(row.projectId).worktreeIssues.push(toIssueLinkedWork(row));
    return byProject as ReadonlyMap<ProjectId, ProjectWorktreeLinkSet>;
  });

  const enrichShells = <P extends OrchestrationProjectShell>(projects: ReadonlyArray<P>) =>
    forProjects(projects.map((project) => project.id)).pipe(
      Effect.map((links) =>
        projects.map((project) => ({
          ...project,
          worktreePullRequests: links.get(project.id)?.worktreePullRequests ?? [],
          worktreeIssues: links.get(project.id)?.worktreeIssues ?? [],
        })),
      ),
      Effect.catch((error) =>
        Effect.logWarning("project worktree links unavailable", { error }).pipe(
          Effect.as(projects),
        ),
      ),
    );

  const publish = (projectId: ProjectId) => PubSub.publish(changes, projectId).pipe(Effect.asVoid);

  const updateProject = <A>(
    projectId: ProjectId,
    update: (links: ReadonlyArray<WorktreePullRequestLink>) => Effect.Effect<{
      readonly links: ReadonlyArray<WorktreePullRequestLink>;
      readonly result: A;
    } | null>,
  ) =>
    writeLock.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* rows.list({ projectId });
        const next = yield* update(current);
        if (next === null) return null;
        yield* rows.replace({ projectId, links: next.links });
        yield* publish(projectId);
        return next;
      }),
    );

  const linkPullRequest: ProjectWorktreeLinks["Service"]["linkPullRequest"] = (input) =>
    updateProject(input.projectId, (links) =>
      Effect.gen(function* () {
        const target = { ...input, ...normalizeThreadPullRequestKey(input) };
        if (links.some((link) => sameTarget(link, target))) return null;
        const link: WorktreePullRequestLink = {
          projectId: input.projectId,
          worktreePath: input.worktreePath,
          ...normalizeThreadPullRequestKey(input),
          url: input.url,
          source: input.source,
          linkedAt: DateTime.formatIso(yield* DateTime.now),
          snapshot: null,
          stack: null,
        };
        return { links: [...links, link], result: true };
      }),
    ).pipe(Effect.map((next) => next !== null));

  const syncPullRequest: ProjectWorktreeLinks["Service"]["syncPullRequest"] = (input) =>
    updateProject(input.projectId, (links) => {
      const target = { ...input, ...normalizeThreadPullRequestKey(input) };
      if (!links.some((link) => sameTarget(link, target))) return Effect.succeed(null);
      return Effect.succeed({
        links: links.map((link) =>
          sameTarget(link, target)
            ? { ...link, snapshot: input.snapshot, stack: input.stack }
            : link,
        ),
        result: undefined,
      });
    }).pipe(Effect.asVoid);

  const unlinkPullRequest: ProjectWorktreeLinks["Service"]["unlinkPullRequest"] = (input) =>
    Effect.gen(function* () {
      const target = { ...input, ...normalizeThreadPullRequestKey(input) };
      const removed = yield* updateProject(input.projectId, (links) =>
        Effect.succeed(
          links.some((link) => sameTarget(link, target))
            ? { links: links.filter((link) => !sameTarget(link, target)), result: undefined }
            : null,
        ),
      );
      if (removed === null) return false;
      const shells = yield* threads
        .listProjectThreads({
          projectId: input.projectId,
          includeSubagents: false,
        })
        .pipe(Effect.orElseSucceed(() => []));
      const now = yield* DateTime.now;
      for (const thread of shells) {
        if (thread.worktreePath !== input.worktreePath) continue;
        for (const link of thread.pullRequests ?? []) {
          if (
            (link.source !== "created" && link.source !== "stack") ||
            !threadPullRequestKeysEqual(link, target)
          )
            continue;
          // Stack members get a tombstone so pull request sync does not re-add them.
          const belongsToStack =
            link.source === "stack" ||
            link.stack !== null ||
            (thread.pullRequests ?? []).some((candidate) =>
              candidate.stack?.layers.some((layer) => layer.number === target.number),
            );
          const commandId = CommandId.make(
            `worktree-pr-unlink:${thread.id}:${target.host}/${target.repository}#${target.number}:${DateTime.toEpochMillis(now)}`,
          );
          yield* threads
            .dispatch(
              belongsToStack
                ? {
                    type: "thread.pull-request.link",
                    commandId,
                    threadId: thread.id,
                    ...target,
                    url: link.url,
                    source: "stack-dismissed",
                  }
                : {
                    type: "thread.pull-request.unlink",
                    commandId,
                    threadId: thread.id,
                    host: target.host,
                    repository: target.repository,
                    number: target.number,
                  },
            )
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("failed to unlink worktree pull request from thread", {
                  threadId: thread.id,
                  cause,
                }),
              ),
            );
        }
      }
      return true;
    });

  return {
    forProjects,
    enrichShells,
    listPullRequests: (projectId) => rows.list(projectId === undefined ? {} : { projectId }),
    linkPullRequest,
    unlinkPullRequest,
    syncPullRequest,
    publish,
    subscribeChanges: PubSub.subscribe(changes).pipe(
      Effect.map((subscription) => Stream.fromSubscription(subscription)),
    ),
  } satisfies ProjectWorktreeLinks["Service"];
});

export const layer = Layer.effect(ProjectWorktreeLinks, make).pipe(
  Layer.provide(WorktreePullRequestRows.layer),
);
