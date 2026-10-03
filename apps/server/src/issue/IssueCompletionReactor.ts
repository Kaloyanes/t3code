import { type IssueLinkedWork, type ProjectId } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProjectWorktreeLinks from "../project/ProjectWorktreeLinks.ts";
import { issuesToCompleteOnMerge } from "./IssueCompletionPolicy.ts";
import * as Issues from "./IssueService.ts";

export class IssueCompletionReactor extends Context.Service<
  IssueCompletionReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
    readonly completeWorktree: (
      projectId: ProjectId,
      worktreePath: string | null,
    ) => Effect.Effect<boolean>;
  }
>()("t3/issue/IssueCompletionReactor") {}

export const make = Effect.gen(function* () {
  const worktreeLinks = yield* ProjectWorktreeLinks.ProjectWorktreeLinks;
  const settings = yield* ServerSettings.ServerSettingsService;
  const issues = yield* Issues.IssueService;
  const handled = new Set<string>();
  const completionLock = yield* Semaphore.make(1);

  const completeWorktree = Effect.fn("IssueCompletionReactor.completeWorktree")(
    function* (projectId: ProjectId, worktreePath: string | null) {
      const enabled = resolveProjectSettings(yield* settings.getSettings, projectId).settings
        .completeLinkedIssueOnMerge;
      const project = (yield* worktreeLinks.forProjects([projectId])).get(projectId);
      const linkedIssues = (project?.worktreeIssues ?? []).filter(
        (link) => link.worktreePath === worktreePath,
      );
      const pullRequests = (project?.worktreePullRequests ?? []).filter(
        (link) => link.worktreePath === worktreePath,
      );
      if (pullRequests.some((link) => link.snapshot?.state !== "merged")) return false;
      if (!enabled || linkedIssues.length === 0) return true;
      const candidates = issuesToCompleteOnMerge({ enabled, issues: linkedIssues, pullRequests });
      if (candidates.length === 0) return false;
      const urls = [...new Set(pullRequests.map((link) => link.url))].sort();
      const body = `Completed in T3 Code via the merged pull requests:\n\n${urls.map((url) => `- ${url}`).join("\n")}`;
      for (const link of candidates) {
        const reference = {
          projectId,
          host: link.issue.host,
          repository: link.issue.repository,
          number: link.issue.number,
        };
        const key = `${link.issue.host}/${link.issue.repository}#${link.issue.number}:${urls.join(",")}`;
        if (handled.has(key)) continue;
        yield* issues.invalidate({ reference });
        const issue = yield* issues.detail(reference);
        if (issue.state !== "closed" || issue.stateReason !== "completed") {
          yield* issues.close({ ...reference, reason: "completed" });
        }
        let cursor: string | undefined;
        let commented = false;
        do {
          const page = yield* issues.comments({
            ...reference,
            limit: 100,
            ...(cursor ? { cursor } : {}),
          });
          commented = page.comments.some((comment) => comment.body === body);
          cursor = page.nextCursor ?? undefined;
        } while (!commented && cursor !== undefined);
        if (!commented) yield* issues.commentCreate({ ...reference, body });
        handled.add(key);
      }
      return true;
    },
    completionLock.withPermits(1),
    Effect.retry({ times: 2 }),
    Effect.catch((error) =>
      Effect.logWarning("linked issue completion failed", { error }).pipe(Effect.as(false)),
    ),
  );

  // GitHub closes issues a merged PR references; reading one records its state on the link.
  const refreshState = (projectId: ProjectId, link: IssueLinkedWork, urls: string) => {
    const key = `refresh:${link.issue.host}/${link.issue.repository}#${link.issue.number}:${urls}`;
    if (handled.has(key)) return Effect.void;
    handled.add(key);
    const reference = {
      projectId,
      host: link.issue.host,
      repository: link.issue.repository,
      number: link.issue.number,
    };
    return issues.invalidate({ reference }).pipe(
      Effect.andThen(issues.detail(reference)),
      Effect.asVoid,
      Effect.catch((error) =>
        Effect.logWarning("linked issue state refresh failed", { error }).pipe(
          Effect.andThen(Effect.sync(() => handled.delete(key))),
        ),
      ),
    );
  };

  const completeProject = Effect.fn("IssueCompletionReactor.completeProject")(function* (
    projectId: ProjectId,
  ) {
    const project = (yield* worktreeLinks.forProjects([projectId])).get(projectId);
    if (project === undefined) return;
    const enabled = resolveProjectSettings(yield* settings.getSettings, projectId).settings
      .completeLinkedIssueOnMerge;
    const candidates = issuesToCompleteOnMerge({
      enabled,
      issues: project.worktreeIssues ?? [],
      pullRequests: project.worktreePullRequests ?? [],
    });
    yield* Effect.forEach(candidates, (link) => completeWorktree(projectId, link.worktreePath), {
      concurrency: 4,
      discard: true,
    });
    yield* Effect.forEach(
      (project.worktreeIssues ?? []).filter(
        (link) => link.state !== "closed" && !candidates.includes(link),
      ),
      (link) => {
        const pullRequests = (project.worktreePullRequests ?? []).filter(
          (pullRequest) => pullRequest.worktreePath === link.worktreePath,
        );
        if (
          pullRequests.length === 0 ||
          pullRequests.some((pullRequest) => pullRequest.snapshot?.state !== "merged")
        )
          return Effect.void;
        const urls = [...new Set(pullRequests.map((pullRequest) => pullRequest.url))].sort();
        return refreshState(projectId, link, urls.join(","));
      },
      { concurrency: 4, discard: true },
    );
  });

  const worker = yield* makeDrainableWorker((projectId: ProjectId) =>
    completeProject(projectId).pipe(
      Effect.catch((error) =>
        Effect.logWarning("linked issue completion sweep failed", { projectId, error }),
      ),
    ),
  );

  const start: IssueCompletionReactor["Service"]["start"] = Effect.fn(
    "IssueCompletionReactor.start",
  )(function* () {
    // A worktree link change may be the merge sync that completes its issues.
    const changes = yield* worktreeLinks.subscribeChanges;
    yield* forkParked(Stream.runForEach(changes, (projectId) => worker.enqueue(projectId)));
  });

  return {
    start,
    drain: worker.drain,
    completeWorktree,
  } satisfies IssueCompletionReactor["Service"];
});

export const layer = Layer.effect(IssueCompletionReactor, make);
