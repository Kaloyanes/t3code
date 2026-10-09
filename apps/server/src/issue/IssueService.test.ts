import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as SqlClient from "effect/sql/SqlClient";
import { describe, expect, it } from "@effect/vitest";

import * as ServerConfig from "../config.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectWorktreeLinks from "../project/ProjectWorktreeLinks.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitHubApi from "../sourceControl/GitHubApi.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WorktreeRunManager from "../worktreeRun/Manager.ts";
import * as IssueService from "./IssueService.ts";
import {
  isSafeIssueWorktreePath,
  issueWorktreeBranch,
  issueWorktreeFragment,
  normalizeIssue,
  issueFilterSearchTerms,
  issueSortOrder,
  compareIssueListEntries,
  issueListEntry,
  normalizeLinkedPullRequests,
  normalizeIssueTimelineEvents,
} from "./IssueService.ts";
import {
  IssueListEntry,
  IssueTimelineEvent,
  ProjectId,
  ThreadId,
  type OrchestrationProjectShell,
} from "@t3tools/contracts";

describe("IssueService pure issue helpers", () => {
  it("normalizes a GitHub issue without trusting missing fields", () => {
    const issue = normalizeIssue(
      {
        number: 42,
        title: "  Fix the checkout  ",
        state: "OPEN",
        author: { login: "octocat", name: null, avatarUrl: null },
        labels: { nodes: [{ name: "bug", color: "b60205" }] },
        comments: { totalCount: 3 },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
      { projectId: ProjectId.make("project-1"), host: "github.com", repository: "owner/repo" },
    );

    expect(issue).not.toBeNull();
    expect(issue?.title).toBe("Fix the checkout");
    expect(issue?.state).toBe("open");
    expect(issue?.commentsCount).toBe(3);
    expect(issue?.labels[0]?.name).toBe("bug");
  });

  it("rejects malformed issue numbers", () => {
    expect(
      normalizeIssue(
        { number: 0, title: "bad" },
        { projectId: ProjectId.make("project-1"), host: "github.com", repository: "owner/repo" },
      ),
    ).toBeNull();
  });

  it("makes deterministic sanitized issue branches", () => {
    expect(issueWorktreeFragment(42, " Fix / checkout ")).toBe("42-fix-checkout");
    expect(issueWorktreeBranch(42, " Fix / checkout ")).toBe("t3code/42-fix-checkout");
    expect(issueWorktreeBranch(42, " Fix / checkout ", 2)).toBe("t3code/42-fix-checkout-2");
    expect(issueWorktreeBranch(42, " Fix / checkout ", undefined, "Kaloyanes")).toBe(
      "Kaloyanes/42-fix-checkout",
    );
    expect(issueWorktreeBranch(42, " Fix / checkout ", undefined, "Kaloyanes", "bug")).toBe(
      "bug/42-fix-checkout",
    );
  });

  it.each([
    ["Fix checkout redirect", "142-fix-checkout-redirect"],
    ["Fix: checkout / login's redirect!", "142-fix-checkout-logins-redirect"],
    ["x".repeat(200), `142-${"x".repeat(60)}`],
    ["修复登录", "142"],
  ])("builds an issue branch from the title %s", (title, fragment) => {
    expect(issueWorktreeFragment(142, title)).toBe(fragment);
    expect(issueWorktreeBranch(142, title, undefined, "Kaloyanes")).toBe(`Kaloyanes/${fragment}`);
    expect(issueWorktreeBranch(142, title, 2, "Kaloyanes")).toBe(`Kaloyanes/${fragment}-2`);
    expect(issueWorktreeBranch(142, title, undefined, "Kaloyanes", "bug")).toBe(`bug/${fragment}`);
  });

  it("only permits deleting the attached worktree, never the project root", () => {
    expect(
      isSafeIssueWorktreePath({
        projectRoot: "/projects/repo",
        attachedPath: "/worktrees/repo/42-fix",
        requestedPath: "/worktrees/repo/42-fix/",
      }),
    ).toBe(true);
    expect(
      isSafeIssueWorktreePath({
        projectRoot: "/projects/repo",
        attachedPath: "/projects/repo",
        requestedPath: "/projects/repo",
      }),
    ).toBe(false);
    expect(
      isSafeIssueWorktreePath({
        projectRoot: "/projects/repo",
        attachedPath: "/worktrees/repo/42-fix",
        requestedPath: "/tmp/unrelated",
      }),
    ).toBe(false);
  });
});

const context = {
  projectId: ProjectId.make("project-1"),
  host: "github.com",
  repository: "owner/repo",
};
const createdAt = "2026-01-01T00:00:00.000Z";
const pr = {
  __typename: "PullRequest",
  number: 7,
  title: "Fix checkout",
  url: "https://github.com/owner/repo/pull/7",
  state: "MERGED",
  isDraft: false,
  repository: { nameWithOwner: "owner/repo" },
};

describe("IssueService list queries", () => {
  it("translates OR groups, exclusions and safely quoted values before host paging", () => {
    expect(
      issueFilterSearchTerms({
        labels: [["bug", 'good "first" issue'], ["web\\ui"]],
        excludedLabels: ["wont fix", 'bad"label'],
        author: "octocat",
        assignee: "hubot",
        milestone: 'Release "1"',
      }),
    ).toEqual([
      'label:"bug","good first issue"',
      'label:"webui"',
      '-label:"wont fix"',
      '-label:"badlabel"',
      'author:"octocat"',
      'assignee:"hubot"',
      'milestone:"Release 1"',
    ]);
    expect(issueFilterSearchTerms(undefined)).toEqual([]);
  });

  it.each([
    ["updated", "updated-desc", "UPDATED_AT", "DESC"],
    ["created-desc", "created-desc", "CREATED_AT", "DESC"],
    ["created-asc", "created-asc", "CREATED_AT", "ASC"],
    ["comments", "comments-desc", "COMMENTS", "DESC"],
  ] as const)("maps %s to both host sort representations", (sort, search, field, direction) => {
    expect(issueSortOrder(sort)).toEqual({ search, orderBy: { field, direction } });
  });

  it("defaults to updated order and respects the selected in-memory order", () => {
    expect(issueSortOrder()).toEqual(issueSortOrder("updated"));
    const older = normalizeIssue(
      { number: 1, createdAt, updatedAt: "2026-01-03T00:00:00.000Z", comments: { totalCount: 9 } },
      context,
    )!;
    const newer = normalizeIssue(
      {
        number: 2,
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: createdAt,
        comments: { totalCount: 1 },
      },
      context,
    )!;
    expect(compareIssueListEntries(older, newer)).toBeLessThan(0);
    expect(compareIssueListEntries(older, newer, "created-desc")).toBeGreaterThan(0);
    expect(compareIssueListEntries(older, newer, "created-asc")).toBeLessThan(0);
    expect(compareIssueListEntries(older, newer, "comments")).toBeLessThan(0);
  });

  it("carries rich row fields through wire encoding without body or reactions", () => {
    const issue = normalizeIssue(
      {
        number: 42,
        title: "Fix checkout",
        body: "Detail only",
        createdAt,
        updatedAt: createdAt,
        state: "CLOSED",
        stateReason: "NOT_PLANNED",
        assignees: { nodes: [{ login: "octocat", name: "Octocat", avatarUrl: null }] },
        milestone: { number: 3, title: "Release", state: "OPEN", dueOn: null },
      },
      context,
    )!;
    const linkedWork = {
      threadId: ThreadId.make("thread-1"),
      branch: "fix/42",
      worktreePath: "/tmp/worktree",
      source: "manual" as const,
    };
    const entry = issueListEntry(issue, linkedWork);
    const encoded = Schema.encodeSync(IssueListEntry)(entry);
    expect(encoded.assignees).toEqual(issue.assignees);
    expect(encoded.milestone).toEqual(issue.milestone);
    expect(encoded.stateReason).toBe("not-planned");
    expect(encoded.linkedWork).toEqual(linkedWork);
    expect(entry).not.toHaveProperty("body");
    expect(entry).not.toHaveProperty("reactions");
    expect(issueListEntry(issue, null).linkedWork).toBeNull();
  });
});

describe("IssueService related work and timeline", () => {
  it("deduplicates closing, cross-referenced and connected PRs by URL", () => {
    expect(
      normalizeLinkedPullRequests({
        closedByPullRequestsReferences: { nodes: [pr] },
        timelineItems: {
          nodes: [{ source: pr }, { subject: pr }, { source: { ...pr, __typename: "Issue" } }],
        },
      }),
    ).toEqual([
      {
        number: 7,
        title: pr.title,
        url: pr.url,
        state: "merged",
        repository: "owner/repo",
        isDraft: false,
      },
    ]);
  });

  it.each([
    [
      { __typename: "LabeledEvent", label: { name: "bug", color: "b60205" } },
      { _tag: "labeled", label: { name: "bug", color: "b60205" } },
    ],
    [
      { __typename: "UnlabeledEvent", label: { name: "bug", color: null } },
      { _tag: "unlabeled", label: { name: "bug", color: null } },
    ],
    [
      { __typename: "AssignedEvent", assignee: { login: "octocat" } },
      { _tag: "assigned", assignee: { login: "octocat", name: null, avatarUrl: null } },
    ],
    [
      { __typename: "UnassignedEvent", assignee: null },
      { _tag: "unassigned", assignee: null },
    ],
    [
      { __typename: "ClosedEvent", stateReason: "COMPLETED" },
      { _tag: "closed", stateReason: "completed" },
    ],
    [{ __typename: "ReopenedEvent" }, { _tag: "reopened" }],
    [
      { __typename: "RenamedTitleEvent", previousTitle: "Before", currentTitle: "After" },
      { _tag: "renamed", from: "Before", to: "After" },
    ],
    [
      { __typename: "MilestonedEvent", milestoneTitle: "Release" },
      { _tag: "milestoned", title: "Release" },
    ],
    [
      { __typename: "DemilestonedEvent", milestoneTitle: "Release" },
      { _tag: "demilestoned", title: "Release" },
    ],
  ])("normalizes $0.__typename with its actor and timestamp", (raw, expected) => {
    const event = normalizeIssueTimelineEvents({
      ...raw,
      id: "event-1",
      actor: { login: "hubot" },
      createdAt,
    })[0]!;
    expect(Schema.decodeSync(IssueTimelineEvent)(event)).toMatchObject({
      ...expected,
      id: "event-1",
      actor: { login: "hubot", name: null, avatarUrl: null },
      createdAt,
    });
  });

  it("normalizes issue and PR references, connected PRs, and interleaved comments", () => {
    const base = { id: "event-1", createdAt, actor: null };
    expect(
      normalizeIssueTimelineEvents({ ...base, __typename: "CrossReferencedEvent", source: pr })[0],
    ).toMatchObject({
      _tag: "cross-referenced",
      source: { kind: "pull-request", number: 7, state: "merged" },
    });
    expect(
      normalizeIssueTimelineEvents({
        ...base,
        __typename: "CrossReferencedEvent",
        source: { ...pr, __typename: "Issue", state: "OPEN" },
      })[0],
    ).toMatchObject({ _tag: "cross-referenced", source: { kind: "issue", state: "open" } });
    expect(
      normalizeIssueTimelineEvents({ ...base, __typename: "ConnectedEvent", subject: pr })[0],
    ).toMatchObject({ _tag: "connected", pullRequest: { number: 7, state: "merged" } });
    const comment = normalizeIssueTimelineEvents({
      ...base,
      __typename: "IssueComment",
      author: { login: "octocat" },
      body: "Hello",
      url: null,
    })[0]!;
    expect(Schema.decodeSync(IssueTimelineEvent)(comment)).toMatchObject({
      _tag: "comment",
      actor: { login: "octocat" },
      comment: { id: "event-1", body: "Hello", createdAt },
    });
    expect(
      normalizeIssueTimelineEvents({
        ...base,
        __typename: "ReferencedEvent",
        commit: {
          associatedPullRequests: {
            nodes: [pr, { ...pr, number: 8, url: "https://github.com/owner/repo/pull/8" }],
          },
        },
      }),
    ).toHaveLength(2);
    expect(
      normalizeIssueTimelineEvents({ ...base, __typename: "ReferencedEvent", commit: null }),
    ).toEqual([]);
    expect(normalizeIssueTimelineEvents({ ...base, __typename: "UnknownEvent" })).toEqual([]);
    expect(normalizeIssueTimelineEvents({ __typename: "ReopenedEvent" })).toEqual([]);
  });
});

type GhCall = {
  readonly kind: "rest" | "graphql";
  readonly endpoint: string;
  readonly method: string;
  readonly query: string;
  readonly variables: Record<string, unknown>;
  readonly body: unknown;
};

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const projectShell = (id: string, repository: string): OrchestrationProjectShell => ({
  id: ProjectId.make(id),
  title: repository,
  workspaceRoot: `/repos/${id}`,
  repositoryIdentity: {
    canonicalKey: `github.com/${repository}`,
    locator: {
      source: "git-remote",
      remoteName: "origin",
      remoteUrl: `https://github.com/${repository}.git`,
    },
    provider: "github",
    owner: repository.split("/")[0]!,
    name: repository.split("/")[1]!,
  },
  defaultModelSelection: null,
  scripts: [],
  createdAt,
  updatedAt: createdAt,
});

const PROJECTS = [projectShell("project-1", "owner/repo"), projectShell("project-2", "owner/api")];

const notFound = new GitHubApi.GitHubApiNotFoundError({
  host: "github.com",
  operation: "IssueService.rest.delete",
});

const isGitHubApiError = Schema.is(
  Schema.Union([GitHubApi.GitHubApiNotFoundError, GitHubApi.GitHubApiResponseError]),
);

const rawIssue = (number: number, extra: Record<string, unknown> = {}) => ({
  number,
  title: `Issue ${number}`,
  state: "OPEN",
  createdAt,
  updatedAt: `2026-01-0${(number % 9) + 1}T00:00:00.000Z`,
  ...extra,
});

const page = (numbers: ReadonlyArray<number>, endCursor: string | null) => ({
  nodes: numbers.map((number) => rawIssue(number)),
  pageInfo: { hasNextPage: endCursor !== null, endCursor },
});

/** Runs the real service against a scripted `gh` and in-memory storage. */
const withIssueService = <A, E>(
  respond: (call: GhCall) => unknown,
  use: (
    service: IssueService.IssueService["Service"],
    calls: ReadonlyArray<GhCall>,
  ) => Effect.Effect<A, E, SqlClient.SqlClient>,
) =>
  Effect.gen(function* () {
    const calls: Array<GhCall> = [];
    const record = (call: GhCall) => {
      calls.push(call);
      return respond(call);
    };
    const gh = Layer.mock(GitHubApi.GitHubApi)({
      rest: (input) =>
        Effect.suspend(() => {
          const reply = record({
            kind: "rest",
            endpoint: input.path,
            method: input.method ?? "GET",
            query: "",
            variables: {},
            body: input.body ?? null,
          });
          return isGitHubApiError(reply)
            ? Effect.fail(reply)
            : Effect.succeed({
                status: 200,
                headers: {},
                body: reply === undefined ? "" : encodeJson(reply),
                truncated: false,
                invalidUtf8: false,
              });
        }),
      graphql: (input) =>
        Effect.suspend(() => {
          const reply = record({
            kind: "graphql",
            endpoint: "graphql",
            method: "POST",
            query: input.query,
            variables: { ...input.variables },
            body: { query: input.query, variables: input.variables },
          });
          return isGitHubApiError(reply)
            ? Effect.fail(reply)
            : Effect.succeed(reply === undefined ? "" : encodeJson(reply));
        }),
    });
    const layer = IssueService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          gh,
          Layer.mock(ProjectService.ProjectService)({
            getShell: (projectId) =>
              Effect.succeed(Option.fromNullishOr(PROJECTS.find((item) => item.id === projectId))),
            listShells: (options) =>
              Effect.succeed(
                PROJECTS.filter(
                  (item) =>
                    options?.projectIds === undefined || options.projectIds.includes(item.id),
                ),
              ),
          }),
          Layer.mock(ThreadManagement.ThreadManagementService)({}),
          Layer.mock(ProjectWorktreeLinks.ProjectWorktreeLinks)({ publish: () => Effect.void }),
          Layer.mock(GitWorkflowService.GitWorkflowService)({}),
          Layer.mock(WorktreeRunManager.WorktreeRunManager)({}),
          Layer.mock(ChildProcessSpawner.ChildProcessSpawner)({}),
          Layer.mock(VcsProcess.VcsProcess)({}),
          ServerConfig.layerTest("/repos", { prefix: "issue-service-test" }),
          ServerSettings.layerTest(),
        ),
      ),
      Layer.provideMerge(SqlitePersistence.layerMemory),
      Layer.provide(NodeServices.layer),
    );
    return yield* Effect.gen(function* () {
      return yield* use(yield* IssueService.IssueService, calls);
    }).pipe(Effect.provide(layer));
  });

const graphQl = (data: unknown) => ({ data });
const graphQlError = (message: string) => ({ errors: [{ message }] });

describe("IssueService against GitHub", () => {
  it.effect("joins only attached links into list rows and picks the latest per issue", () =>
    withIssueService(
      (call) => {
        if (call.query.includes("issues(first"))
          return graphQl({ repository: { issues: page([1, 2, 3], null) } });
        if (call.query.includes("viewer")) return graphQl({ repository: { issue: rawIssue(1) } });
        return graphQl({ repository: { issue: {} } });
      },
      (service, calls) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const insert = (
            thread: string,
            number: number,
            linkedAt: string,
            branch: string | null,
            detachedAt: string | null = null,
          ) => sql`
            INSERT INTO projection_issue_links (
              thread_id, project_id, host, repository, number, source, linked_at,
              branch, worktree_path, detached_at
            ) VALUES (${thread}, 'project-1', 'github.com', 'owner/repo', ${number}, 'manual',
              ${linkedAt}, ${branch}, ${null}, ${detachedAt})
          `;
          yield* insert("older", 1, "2026-01-01T00:00:00.000Z", "fix/old");
          yield* insert("newer", 1, "2026-01-03T00:00:00.000Z", "fix/new");
          yield* insert("detached-newest", 1, "2026-01-05T00:00:00.000Z", null, createdAt);
          yield* insert("only-detached", 2, "2026-01-05T00:00:00.000Z", null, createdAt);
          yield* insert("blank", 3, "2026-01-02T00:00:00.000Z", "");

          const result = yield* service.list({ state: "open", projectId: PROJECTS[0]!.id });
          const linked = new Map(result.entries.map((entry) => [entry.number, entry.linkedWork]));
          expect(linked.get(1)).toMatchObject({ threadId: "newer", branch: "fix/new" });
          expect(linked.get(2)).toBeNull();
          expect(linked.get(3)).toMatchObject({ threadId: "blank", branch: null });
          expect(calls[0]!.query).not.toContain("description");

          const detail = yield* service.detail({ ...context, number: 1 });
          expect(detail.linkedWork).toMatchObject({ threadId: "newer" });
        }),
    ),
  );

  it.effect("searches with a bare viewer qualifier and keeps rows it cannot re-check", () =>
    withIssueService(
      (call) =>
        call.query.includes("search(")
          ? graphQl({
              search: page([4], null),
            })
          : undefined,
      (service, calls) =>
        Effect.gen(function* () {
          const result = yield* service.list({
            state: "open",
            projectId: PROJECTS[0]!.id,
            filters: { assignee: "@me", author: "ME" },
          });
          expect(result.entries.map((entry) => entry.number)).toEqual([4]);
          expect(calls).toHaveLength(1);
          const query = String(calls[0]!.variables.query);
          expect(query).toContain("assignee:@me");
          expect(query).toContain("author:@me");
          expect(query).not.toContain('"@me"');
        }),
    ),
  );

  it.effect("returns every fetched row across repositories and keeps searching the rest", () =>
    withIssueService(
      (call) => {
        const query = String(call.variables.query);
        if (query.includes("repo:owner/repo"))
          return graphQl({
            search:
              call.variables.after === "repo-next" ? page([3], null) : page([1, 2], "repo-next"),
          });
        if (query.includes("repo:owner/api")) return graphQl({ search: page([5, 6], null) });
        return undefined;
      },
      (service) =>
        Effect.gen(function* () {
          const first = yield* service.list({ state: "open", limit: 2 });
          expect(
            first.entries.map((entry) => `${entry.repository}#${entry.number}`).sort(),
          ).toEqual(["owner/api#5", "owner/api#6", "owner/repo#1", "owner/repo#2"]);
          expect(first.truncated).toBe(true);
          expect(first.nextCursors).toEqual({
            "project-1:github.com:owner/repo": "search:repo-next",
          });

          const next = yield* service.list({
            state: "open",
            limit: 2,
            repositories: [{ projectId: PROJECTS[0]!.id, repository: "owner/repo" }],
            cursors: first.nextCursors,
          });
          expect(next.entries.map((entry) => entry.number)).toEqual([3]);
          expect(next.truncated).toBe(false);
        }),
    ),
  );

  it.effect("degrades to timeline pull requests and no sub-issues on older hosts", () =>
    withIssueService(
      (call) => {
        if (call.query.includes("subIssues"))
          return graphQlError("Field 'subIssues' doesn't exist");
        if (call.query.includes("closedByPullRequestsReferences"))
          return graphQlError(
            "Field 'closedByPullRequestsReferences' doesn't accept argument 'includeClosedPrs'",
          );
        if (call.query.includes("viewer"))
          return graphQl({
            repository: {
              issue: rawIssue(42, { timelineItems: { nodes: [{ source: pr }] } }),
            },
            viewer: { login: "octocat" },
          });
        return undefined;
      },
      (service, calls) =>
        Effect.gen(function* () {
          const detail = yield* service.detail({ ...context, number: 42 });
          expect(detail.linkedPullRequests?.map((item) => item.number)).toEqual([7]);
          expect(detail).not.toHaveProperty("subIssues");
          expect(detail.viewer).toBe("octocat");
          expect(calls.filter((call) => call.query.includes("viewer"))).toHaveLength(2);
        }),
    ),
  );

  it.effect("still fails detail for errors unrelated to closing pull requests", () =>
    withIssueService(
      (call) =>
        call.query.includes("subIssues")
          ? graphQl({ repository: { issue: {} } })
          : graphQlError("Could not resolve to a Repository"),
      (service, calls) =>
        Effect.gen(function* () {
          const error = yield* service.detail({ ...context, number: 42 }).pipe(Effect.flip);
          expect(error).toMatchObject({ _tag: "IssueOperationError" });
          expect(calls.filter((call) => call.query.includes("viewer"))).toHaveLength(1);
        }),
    ),
  );

  it.effect("normalizes timeline pages, including bot assignees", () =>
    withIssueService(
      (call) =>
        call.query.includes("timelineItems(first: $first")
          ? graphQl({
              repository: {
                issue: {
                  timelineItems: {
                    nodes: [
                      {
                        __typename: "AssignedEvent",
                        id: "assigned-1",
                        createdAt,
                        actor: { login: "octocat" },
                        assignee: { login: "renovate[bot]", avatarUrl: null },
                      },
                      { __typename: "UnknownEvent", id: "skip", createdAt },
                      {
                        __typename: "IssueComment",
                        id: "comment-node",
                        databaseId: 99,
                        body: "On it",
                        createdAt,
                        author: { login: "hubot" },
                      },
                    ],
                    totalCount: 3,
                    pageInfo: { hasNextPage: true, endCursor: "timeline-next" },
                  },
                },
              },
            })
          : undefined,
      (service, calls) =>
        Effect.gen(function* () {
          const result = yield* service.timeline({ ...context, number: 42, limit: 2 });
          expect(calls[0]!.query).toContain("... on Bot");
          expect(calls[0]!.variables).toMatchObject({ number: 42, first: 2, after: null });
          expect(result).toMatchObject({
            totalCount: 3,
            nextCursor: "timeline-next",
            truncated: true,
            events: [
              { _tag: "assigned", assignee: { login: "renovate[bot]" } },
              { _tag: "comment", actor: { login: "hubot" }, comment: { body: "On it" } },
            ],
          });
        }),
    ),
  );

  it.effect("applies additive label and assignee edits through their own endpoints", () =>
    withIssueService(
      (call) => {
        if (call.endpoint.endsWith("/labels/gone%20label")) return notFound;
        if (call.query.includes("viewer"))
          return graphQl({ repository: { issue: rawIssue(42) }, viewer: { login: "octocat" } });
        if (call.query.includes("subIssues")) return graphQl({ repository: { issue: {} } });
        return {};
      },
      (service, calls) =>
        Effect.gen(function* () {
          const result = yield* service.update({
            ...context,
            number: 42,
            title: "Renamed",
            addLabels: ["bug"],
            removeLabels: ["gone label", "area/web"],
            addAssignees: ["octocat"],
            removeAssignees: ["hubot"],
          });
          expect(result.issue.number).toBe(42);
          const issue = "repos/owner/repo/issues/42";
          expect(
            calls
              .filter((call) => call.kind === "rest")
              .map((call) => [call.method, call.endpoint, call.body]),
          ).toEqual([
            ["PATCH", issue, { title: "Renamed" }],
            ["POST", `${issue}/labels`, { labels: ["bug"] }],
            ["DELETE", `${issue}/labels/gone%20label`, null],
            ["DELETE", `${issue}/labels/area%2Fweb`, null],
            ["POST", `${issue}/assignees`, { assignees: ["octocat"] }],
            ["DELETE", `${issue}/assignees`, { assignees: ["hubot"] }],
          ]);
        }),
    ),
  );

  it.effect("fails an additive edit on errors other than an already removed label", () =>
    withIssueService(
      (call) =>
        call.endpoint.endsWith("/assignees")
          ? new GitHubApi.GitHubApiResponseError({
              host: "github.com",
              operation: "IssueService.rest.post",
              status: 422,
            })
          : {},
      (service, calls) =>
        Effect.gen(function* () {
          const error = yield* service
            .update({ ...context, number: 42, addAssignees: ["ghost"] })
            .pipe(Effect.flip);
          expect(error).toMatchObject({ _tag: "IssueOperationError" });
          expect(calls.map((call) => call.method)).toEqual(["POST"]);
        }),
    ),
  );
});
