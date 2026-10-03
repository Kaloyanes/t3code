import {
  EnvironmentId,
  IssueOperationError,
  IssueUnavailableError,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type IssueComment,
  type IssueCommentsResult,
  type IssueDetail,
  type IssueListResult,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/unstable/ai";

import * as IssueService from "../../../issue/IssueService.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import { v2PullRequestThread } from "../../../orchestration-v2/testkit/pullRequestFixtures.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { IssuesToolkitHandlersLive } from "./handlers.ts";
import { IssuesToolkit } from "./tools.ts";

const PROJECT_ID = ProjectId.make("project-1");
const THREAD_ID = ThreadId.make("thread-1");
const DATE = "2026-08-01T00:00:00.000Z";
const REF = { projectId: PROJECT_ID, repository: "t3tools/t3code", number: 42 };
const ISSUE: IssueDetail = {
  ...REF,
  provider: "github",
  host: "github.com",
  projectTitle: "T3 Code",
  title: "Issue tools",
  body: "Expose issues through MCP.",
  url: "https://github.com/t3tools/t3code/issues/42",
  author: null,
  state: "open",
  stateReason: null,
  createdAt: DATE,
  updatedAt: DATE,
  closedAt: null,
  labels: [],
  assignees: [],
  milestone: null,
  commentsCount: 2,
};
const COMMENT: IssueComment = {
  id: "comment-1",
  author: null,
  body: "Working on this.",
  createdAt: DATE,
  url: `${ISSUE.url}#issuecomment-1`,
};
const COMMENTS: IssueCommentsResult = {
  comments: [COMMENT],
  nextCursor: "comments-next",
  commentCount: 2,
  truncated: true,
};
const LIST: IssueListResult = {
  providers: [],
  entries: [ISSUE],
  errors: [{ projectId: PROJECT_ID, repository: "t3tools/other", message: "Unavailable" }],
  truncated: true,
  nextCursors: { "github.com/t3tools/t3code": "issues-next" },
};

type Method =
  | "list"
  | "detail"
  | "comments"
  | "commentCreate"
  | "close"
  | "reopen"
  | "update"
  | "link";

const REQUESTS = [
  { name: "list_issues", input: { state: "open" }, method: "list", error: "IssueListFailedError" },
  { name: "read_issue", input: REF, method: "detail", error: "IssueReadFailedError" },
  {
    name: "comment_on_issue",
    input: { ...REF, body: "Hello" },
    method: "commentCreate",
    error: "IssueCommentFailedError",
  },
  { name: "close_issue", input: REF, method: "close", error: "IssueCloseFailedError" },
  { name: "reopen_issue", input: REF, method: "reopen", error: "IssueReopenFailedError" },
  {
    name: "update_issue",
    input: { ...REF, title: "Updated" },
    method: "update",
    error: "IssueUpdateFailedError",
  },
  { name: "link_issue", input: REF, method: "link", error: "IssueLinkFailedError" },
] as const;

const makeHarness = Effect.fn("makeIssuesToolkitHarness")(function* (
  options: {
    readonly fail?: Method;
    readonly unavailable?: boolean;
    readonly missingThread?: boolean;
    readonly threadFailure?: boolean;
  } = {},
) {
  const calls: Array<{ readonly method: Method; readonly input: unknown }> = [];
  const record = <A>(method: Method, input: unknown, result: A) =>
    Effect.gen(function* () {
      calls.push({ method, input });
      if (options.fail === method) {
        return yield* options.unavailable
          ? new IssueUnavailableError({ reason: "cli-unauthenticated", host: "github.com" })
          : new IssueOperationError({ operation: method, detail: "private host failure" });
      }
      return result;
    });
  const dependencies = Layer.mergeAll(
    Layer.mock(IssueService.IssueService)({
      list: (input) => record("list", input, LIST),
      detail: (input) => record("detail", input, ISSUE),
      comments: (input) => record("comments", input, COMMENTS),
      commentCreate: (input) =>
        record("commentCreate", input, { comment: { ...COMMENT, body: input.body } }),
      close: (input) =>
        record("close", input, {
          issue: {
            ...ISSUE,
            state: "closed" as const,
            stateReason: input.reason ?? "completed",
            closedAt: DATE,
          },
        }),
      reopen: (input) => record("reopen", input, { issue: ISSUE }),
      update: (input) =>
        record("update", input, {
          issue: { ...ISSUE, title: input.title ?? ISSUE.title, body: input.body ?? ISSUE.body },
        }),
      link: (input) =>
        record("link", input, {
          linkedWork: {
            issue: {
              provider: "github" as const,
              host: "github.com",
              repository: input.repository,
              number: input.number,
            },
            threadId: input.threadId,
            projectId: input.projectId,
            branch: "feat/issues",
            worktreePath: null,
            linkedAt: DATE,
            source: input.source ?? "manual",
          },
        }),
    }),
    Layer.mock(Orchestrator.OrchestratorV2)({
      getThreadShell: (id) =>
        options.threadFailure
          ? Effect.fail(
              new Orchestrator.OrchestratorProjectionError({
                threadId: id,
                cause: "private storage failure",
              }),
            )
          : Effect.succeed(
              options.missingThread
                ? null
                : v2PullRequestThread({
                    id,
                    projectId: PROJECT_ID,
                    title: "Thread",
                    modelSelection: {
                      instanceId: ProviderInstanceId.make("codex"),
                      model: "gpt-5",
                    },
                    runtimeMode: "full-access",
                    interactionMode: "default",
                    branch: "feat/issues",
                    worktreePath: null,
                    pullRequests: [],
                    createdAt: DATE,
                    updatedAt: DATE,
                    archivedAt: null,
                    settledOverride: null,
                    settledAt: null,
                    latestUserMessageAt: null,
                  }),
            ),
    }),
  );
  const toolkit = yield* IssuesToolkit.pipe(
    Effect.provide(IssuesToolkitHandlersLive.pipe(Layer.provide(dependencies))),
  );
  const call = <Name extends keyof typeof IssuesToolkit.tools>(
    name: Name,
    params: unknown,
    capabilities: ReadonlyArray<McpInvocationContext.McpCapability> = ["pull-requests"],
  ) =>
    toolkit.handle(name, params as Parameters<typeof toolkit.handle<Name>>[1]).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map(
        (chunk) => chunk.at(-1)!.result as Tool.Success<(typeof IssuesToolkit.tools)[Name]>,
      ),
      Effect.provideService(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("environment-1"),
        threadId: THREAD_ID,
        providerSessionId: "provider-session-1",
        providerInstanceId: ProviderInstanceId.make("codex"),
        capabilities: new Set(capabilities),
        issuedAt: 1,
      }),
      Effect.provide(dependencies),
    );
  return { calls, call };
});

describe("issues toolkit handlers", () => {
  for (const request of REQUESTS) {
    it.effect(`${request.name} refuses credentials without the pull-requests capability`, () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const error = yield* harness
          .call(request.name, request.input, ["preview"])
          .pipe(Effect.flip);
        expect(error).toMatchObject({
          _tag: "McpCapabilityUnavailableError",
          capability: "pull-requests",
          threadId: THREAD_ID,
        });
        expect(harness.calls).toEqual([]);
      }),
    );

    it.effect(`${request.name} maps service failures without exposing their message`, () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({ fail: request.method });
        const error = yield* harness.call(request.name, request.input).pipe(Effect.flip);
        expect(error).toMatchObject({ _tag: request.error });
        expect(error.message).not.toContain("private host failure");
      }),
    );
  }

  it.effect(
    "passes list filters and cursors through and preserves pagination and repository errors",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const input = {
          state: "closed" as const,
          projectId: PROJECT_ID,
          query: " tools ",
          involvement: "assigned" as const,
          filters: {
            labels: [["bug", "feature"]],
            excludedLabels: ["wontfix"],
            author: "maintainer",
            assignee: "@me",
            milestone: "v1",
          },
          cursors: { "github.com/t3tools/t3code": "previous-page" },
          limit: 25,
        };
        expect(yield* harness.call("list_issues", input)).toEqual(LIST);
        expect(harness.calls).toEqual([{ method: "list", input: { ...input, query: "tools" } }]);
      }),
  );

  it.effect("reads issue details with the first page of comments and its next cursor", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      expect(yield* harness.call("read_issue", REF)).toEqual({ issue: ISSUE, comments: COMMENTS });
      expect(harness.calls).toEqual([
        { method: "detail", input: REF },
        { method: "comments", input: REF },
      ]);
    }),
  );

  it.effect("maps a comments failure to the read error", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ fail: "comments" });
      expect(yield* harness.call("read_issue", REF).pipe(Effect.flip)).toMatchObject({
        _tag: "IssueReadFailedError",
      });
    }),
  );

  it.effect("maps an unauthenticated GitHub CLI to the operation error", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ fail: "list", unavailable: true });
      expect(yield* harness.call("list_issues", { state: "open" }).pipe(Effect.flip)).toMatchObject(
        {
          _tag: "IssueListFailedError",
          cause: { _tag: "IssueUnavailableError", reason: "cli-unauthenticated" },
        },
      );
    }),
  );

  it.effect("posts the supplied comment and returns the created comment", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call("comment_on_issue", {
        ...REF,
        body: "Comment **markdown**",
      });
      expect(result.comment.body).toBe("Comment **markdown**");
      expect(result.comment.url).toBe(COMMENT.url);
    }),
  );

  it.effect("closes with the requested reason and supports reopening", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const closed = yield* harness.call("close_issue", { ...REF, reason: "not-planned" });
      expect(closed.issue).toMatchObject({ state: "closed", stateReason: "not-planned" });
      const reopened = yield* harness.call("reopen_issue", REF);
      expect(reopened.issue).toMatchObject({ state: "open", stateReason: null });
      expect(harness.calls).toEqual([
        { method: "close", input: { ...REF, reason: "not-planned" } },
        { method: "reopen", input: REF },
      ]);
    }),
  );

  it.effect("preserves explicit empty updates and decodes titles", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const input = {
        ...REF,
        title: " Updated title ",
        body: "",
        labels: [],
        assignees: [],
        milestone: null,
      };
      const result = yield* harness.call("update_issue", input);
      expect(result.issue).toMatchObject({ title: "Updated title", body: "" });
      expect(harness.calls).toEqual([
        { method: "update", input: { ...input, title: "Updated title" } },
      ]);
    }),
  );

  it.effect("links only to the credential's thread with source agent", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const input = { ...REF, threadId: "other-thread", source: "manual" };
      const result = yield* harness.call("link_issue", input);
      expect(result.linkedWork).toMatchObject({
        threadId: THREAD_ID,
        source: "agent",
        issue: { repository: REF.repository, number: REF.number },
      });
      expect(harness.calls).toEqual([
        { method: "link", input: { ...REF, threadId: THREAD_ID, source: "agent" } },
      ]);
    }),
  );

  it.effect("refuses to change issues outside the calling thread's project but reads them", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const other = { ...REF, projectId: ProjectId.make("project-2") };
      for (const request of REQUESTS.slice(2)) {
        const error = yield* harness
          .call(request.name, { ...request.input, projectId: other.projectId })
          .pipe(Effect.flip);
        expect(error).toMatchObject({
          _tag: "IssueOutsideThreadProjectError",
          projectId: "project-2",
        });
      }
      expect(harness.calls).toEqual([]);
      yield* harness.call("read_issue", other);
      expect(harness.calls.map((call) => call.method)).toEqual(["detail", "comments"]);
    }),
  );

  it.effect("rejects an invalid issue number before calling the service", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.call("close_issue", { ...REF, number: 0 }).pipe(Effect.flip);
      expect(harness.calls).toEqual([]);
    }),
  );

  it.effect("rejects an invalid close reason before calling the service", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.call("close_issue", { ...REF, reason: "invalid" }).pipe(Effect.flip);
      expect(harness.calls).toEqual([]);
    }),
  );

  it.effect("refuses a credential whose thread no longer exists", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ missingThread: true });
      expect(yield* harness.call("list_issues", { state: "open" }).pipe(Effect.flip)).toMatchObject(
        { _tag: "IssueThreadNotFoundError", threadId: THREAD_ID },
      );
      expect(harness.calls).toEqual([]);
    }),
  );

  it.effect("maps a caller lookup failure before invoking the issue service", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ threadFailure: true });
      const error = yield* harness.call("link_issue", REF).pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "IssueLinkFailedError" });
      expect(error.message).toBe("Could not link the issue.");
      expect(harness.calls).toEqual([]);
    }),
  );
});
