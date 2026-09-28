import {
  EventId,
  IssueOperationError,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type IssueCloseInput,
  type IssueCommentCreateInput,
  type IssueComment,
  type IssueDetail,
  type OrchestrationEvent,
  type OrchestrationProjectShell,
  type OrchestrationShellSnapshot,
  type OrchestrationThreadShell,
  type WorktreePullRequestLink,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import { ServerActivation } from "../serverActivation.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { IssueService } from "./IssueService.ts";
import * as IssueCompletionReactor from "./IssueCompletionReactor.ts";

const NOW = "2026-09-19T11:00:00.000Z";
const PROJECT_ID = ProjectId.make("project");
const THREAD_ID = ThreadId.make("thread");
const WORKTREE_PATH = "/tmp/worktree";
const COMMENT_BODY =
  "Completed in T3 Code via the merged pull requests:\n\n- https://github.com/acme/repo/pull/7";

function pullRequest(state: "open" | "closed" | "merged"): WorktreePullRequestLink {
  return {
    projectId: PROJECT_ID,
    worktreePath: WORKTREE_PATH,
    host: "github.com",
    repository: "acme/repo",
    number: 7,
    url: "https://github.com/acme/repo/pull/7",
    source: "created",
    linkedAt: NOW,
    snapshot: {
      title: "PR 7",
      state,
      isDraft: false,
      headBranch: "feature",
      baseBranch: "main",
      updatedAt: NOW,
      closedAt: state === "closed" ? NOW : null,
      mergedAt: state === "merged" ? NOW : null,
      syncedAt: NOW,
    },
    stack: null,
  };
}

function snapshot(state: "open" | "closed" | "merged"): OrchestrationShellSnapshot {
  const project: OrchestrationProjectShell = {
    id: PROJECT_ID,
    title: "Project",
    workspaceRoot: "/workspace/project",
    defaultModelSelection: null,
    scripts: [],
    worktreePullRequests: [pullRequest(state)],
    worktreeIssues: [
      {
        issue: { provider: "github", host: "github.com", repository: "acme/repo", number: 42 },
        threadId: THREAD_ID,
        projectId: PROJECT_ID,
        branch: "feature",
        worktreePath: WORKTREE_PATH,
        linkedAt: NOW,
        source: "manual",
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };
  const thread: OrchestrationThreadShell = {
    id: THREAD_ID,
    projectId: PROJECT_ID,
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "feature",
    worktreePath: WORKTREE_PATH,
    pullRequests: [],
    latestTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
  return { snapshotSequence: 1, projects: [project], threads: [thread], updatedAt: NOW };
}

function detail(state: "open" | "closed"): IssueDetail {
  return {
    provider: "github",
    host: "github.com",
    projectId: PROJECT_ID,
    projectTitle: "Project",
    repository: "acme/repo",
    number: 42,
    title: "Issue 42",
    body: "",
    url: "https://github.com/acme/repo/issues/42",
    author: null,
    state,
    stateReason: state === "closed" ? "not-planned" : null,
    createdAt: NOW,
    updatedAt: NOW,
    closedAt: state === "closed" ? NOW : null,
    labels: [],
    assignees: [],
    milestone: null,
    commentsCount: 0,
  };
}

const projectUpdated = (state: "open" | "closed" | "merged"): OrchestrationEvent => ({
  type: "project.meta-updated",
  sequence: 1,
  eventId: EventId.make("project-updated"),
  aggregateKind: "project",
  aggregateId: PROJECT_ID,
  occurredAt: NOW,
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
  payload: { projectId: PROJECT_ID, worktreePullRequests: [pullRequest(state)], updatedAt: NOW },
});

function runCase(input: {
  readonly enabled: boolean;
  readonly pullRequestState: "open" | "closed" | "merged";
  readonly issueState?: "open" | "closed";
  readonly completed?: boolean;
  readonly existingComment?: boolean;
  readonly failComment?: boolean;
  readonly failCloseOnce?: boolean;
  readonly repeat?: boolean;
  readonly noIssue?: boolean;
  readonly otherPullRequestState?: "open" | "closed" | "merged";
}) {
  return Effect.scoped(
    Effect.gen(function* () {
      const currentSnapshot = snapshot(input.pullRequestState);
      const project = currentSnapshot.projects[0]!;
      const projectSnapshot = {
        ...currentSnapshot,
        projects: [
          {
            ...project,
            ...(input.noIssue ? { worktreeIssues: [] } : {}),
            ...(input.otherPullRequestState
              ? {
                  worktreePullRequests: [
                    ...(project.worktreePullRequests ?? []),
                    {
                      ...pullRequest(input.otherPullRequestState),
                      number: 8,
                      url: "https://github.com/acme/repo/pull/8",
                    },
                  ],
                }
              : {}),
          },
        ],
      };
      const activation = yield* Deferred.make<void>();
      const snapshotRead = yield* Deferred.make<void>();
      const events = yield* PubSub.unbounded<OrchestrationEvent>();
      const closes: IssueCloseInput[] = [];
      const comments: IssueCommentCreateInput[] = [];
      const calls: string[] = [];
      const savedComments: IssueComment[] = input.existingComment
        ? [{ id: "existing", author: null, body: COMMENT_BODY, createdAt: NOW, url: null }]
        : [];
      let currentDetail = detail(input.issueState ?? "open");
      if (input.completed) currentDetail = { ...currentDetail, stateReason: "completed" };
      let closeFailed = false;
      const layer = IssueCompletionReactor.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(ProjectionSnapshotQuery)({
              getShellSnapshot: () =>
                Deferred.succeed(snapshotRead, undefined).pipe(Effect.as(projectSnapshot)),
            }),
            Layer.mock(OrchestrationEngineService)({
              subscribeDomainEvents: PubSub.subscribe(events).pipe(
                Effect.map((subscription) => Stream.fromSubscription(subscription)),
              ),
            }),
            ServerSettingsService.layerTest({ completeLinkedIssueOnMerge: input.enabled }),
            Layer.mock(IssueService)({
              detail: () => Effect.succeed(currentDetail),
              invalidate: () => Effect.void,
              close: (closeInput) =>
                Effect.gen(function* () {
                  calls.push("close");
                  if (input.failCloseOnce && !closeFailed) {
                    closeFailed = true;
                    return yield* new IssueOperationError({
                      operation: "close",
                      detail: "Try again",
                    });
                  }
                  closes.push(closeInput);
                  currentDetail = { ...currentDetail, state: "closed", stateReason: "completed" };
                  return { issue: currentDetail };
                }),
              comments: (query) =>
                Effect.succeed({
                  comments: query.cursor === undefined ? [] : savedComments,
                  nextCursor: query.cursor === undefined ? "next-page" : null,
                  commentCount: savedComments.length,
                  truncated: query.cursor === undefined,
                }),
              commentCreate: (commentInput) =>
                Effect.gen(function* () {
                  calls.push("comment");
                  if (input.failComment) {
                    return yield* new IssueOperationError({
                      operation: "comment",
                      detail: "Try again",
                    });
                  }
                  comments.push(commentInput);
                  const comment = {
                    id: "new",
                    author: null,
                    body: commentInput.body,
                    createdAt: NOW,
                    url: null,
                  };
                  savedComments.push(comment);
                  return { comment };
                }),
            }),
            Layer.succeed(ServerActivation, Deferred.await(activation)),
          ),
        ),
      );
      return yield* Effect.gen(function* () {
        const reactor = yield* IssueCompletionReactor.IssueCompletionReactor;
        yield* reactor.start();
        yield* Deferred.succeed(activation, undefined);
        yield* PubSub.publish(events, projectUpdated(input.pullRequestState));
        if (input.pullRequestState === "merged") yield* Deferred.await(snapshotRead);
        yield* reactor.drain;
        const cleanupAllowed = input.repeat
          ? yield* reactor.completeWorktree(PROJECT_ID, WORKTREE_PATH)
          : undefined;
        return { closes, comments, calls, cleanupAllowed };
      }).pipe(Effect.provide(layer));
    }),
  );
}

describe("IssueCompletionReactor", () => {
  it.effect(
    "completes the linked issue and comments with the merged PR before allowing cleanup",
    () =>
      Effect.gen(function* () {
        const result = yield* runCase({ enabled: true, pullRequestState: "merged", repeat: true });
        assert.deepStrictEqual(
          result.closes.map(({ reason }) => reason),
          ["completed"],
        );
        assert.deepStrictEqual(
          result.comments.map(({ body }) => body),
          [COMMENT_BODY],
        );
        assert.deepStrictEqual(result.calls, ["close", "comment"]);
        assert.strictEqual(result.cleanupAllowed, true);
      }),
  );

  it.effect("does nothing for disabled, closed, or open pull requests", () =>
    Effect.gen(function* () {
      for (const input of [
        { enabled: false, pullRequestState: "merged" },
        { enabled: true, pullRequestState: "closed" },
        { enabled: true, pullRequestState: "open" },
      ] as const) {
        assert.deepStrictEqual((yield* runCase(input)).calls, []);
      }
    }),
  );

  it.effect(
    "updates closed issues to completed and comments on issues GitHub already completed",
    () =>
      Effect.gen(function* () {
        const closed = yield* runCase({
          enabled: true,
          pullRequestState: "merged",
          issueState: "closed",
        });
        assert.deepStrictEqual(closed.calls, ["close", "comment"]);
        const completed = yield* runCase({
          enabled: true,
          pullRequestState: "merged",
          issueState: "closed",
          completed: true,
        });
        assert.deepStrictEqual(completed.calls, ["comment"]);
      }),
  );

  it.effect("finds a previous completion comment on later pages without posting it again", () =>
    Effect.gen(function* () {
      const result = yield* runCase({
        enabled: true,
        pullRequestState: "merged",
        existingComment: true,
      });
      assert.deepStrictEqual(result.calls, ["close"]);
    }),
  );

  it.effect("retries closure before commenting and retries failed comments after closure", () =>
    Effect.gen(function* () {
      const retried = yield* runCase({
        enabled: true,
        pullRequestState: "merged",
        failCloseOnce: true,
      });
      assert.deepStrictEqual(retried.calls, ["close", "close", "comment"]);
      const failed = yield* runCase({
        enabled: true,
        pullRequestState: "merged",
        failComment: true,
        repeat: true,
      });
      assert.strictEqual(failed.closes.length, 1);
      assert.strictEqual(failed.comments.length, 0);
      assert.strictEqual(failed.cleanupAllowed, false);
    }),
  );

  it.effect("waits for every PR even without an issue, then allows cleanup", () =>
    Effect.gen(function* () {
      for (const noIssue of [false, true]) {
        const pending = yield* runCase({
          enabled: true,
          pullRequestState: "merged",
          otherPullRequestState: "open",
          noIssue,
          repeat: true,
        });
        assert.deepStrictEqual(pending.calls, []);
        assert.strictEqual(pending.cleanupAllowed, false);
        const merged = yield* runCase({
          enabled: true,
          pullRequestState: "merged",
          otherPullRequestState: "merged",
          noIssue,
          repeat: true,
        });
        assert.strictEqual(merged.cleanupAllowed, true);
        assert.deepStrictEqual(
          merged.comments.map(({ body }) => body),
          noIssue ? [] : [COMMENT_BODY + "\n- https://github.com/acme/repo/pull/8"],
        );
      }
    }),
  );
});
