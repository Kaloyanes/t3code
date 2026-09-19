import {
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type IssueCloseInput,
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
import * as Ref from "effect/Ref";
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
}) {
  return Effect.scoped(
    Effect.gen(function* () {
      const activation = yield* Deferred.make<void>();
      const snapshotRead = yield* Deferred.make<void>();
      const events = yield* PubSub.unbounded<OrchestrationEvent>();
      const closes = yield* Ref.make<ReadonlyArray<IssueCloseInput>>([]);
      const currentDetail = detail(input.issueState ?? "open");
      const layer = IssueCompletionReactor.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(ProjectionSnapshotQuery)({
              getShellSnapshot: () =>
                Deferred.succeed(snapshotRead, undefined).pipe(
                  Effect.as(snapshot(input.pullRequestState)),
                ),
            }),
            Layer.mock(OrchestrationEngineService)({
              subscribeDomainEvents: PubSub.subscribe(events).pipe(
                Effect.map((subscription) => Stream.fromSubscription(subscription)),
              ),
            }),
            ServerSettingsService.layerTest({ completeLinkedIssueOnMerge: input.enabled }),
            Layer.mock(IssueService)({
              detail: () => Effect.succeed(currentDetail),
              close: (closeInput) =>
                Ref.update(closes, (values) => [...values, closeInput]).pipe(
                  Effect.as({
                    issue: { ...currentDetail, state: "closed", stateReason: "completed" },
                  }),
                ),
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
        return yield* Ref.get(closes);
      }).pipe(Effect.provide(layer));
    }),
  );
}

describe("IssueCompletionReactor", () => {
  it.effect("completes the linked issue after the worktree pull request merges", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* runCase({ enabled: true, pullRequestState: "merged" }), [
        {
          projectId: PROJECT_ID,
          host: "github.com",
          repository: "acme/repo",
          number: 42,
          reason: "completed",
        },
      ]);
    }),
  );

  it.effect("does not complete for disabled, closed, open, or already closed issues", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* runCase({ enabled: false, pullRequestState: "merged" }), []);
      assert.deepStrictEqual(yield* runCase({ enabled: true, pullRequestState: "closed" }), []);
      assert.deepStrictEqual(yield* runCase({ enabled: true, pullRequestState: "open" }), []);
      assert.deepStrictEqual(
        yield* runCase({ enabled: true, pullRequestState: "merged", issueState: "closed" }),
        [],
      );
    }),
  );
});
