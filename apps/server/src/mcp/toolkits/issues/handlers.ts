import * as Effect from "effect/Effect";

import * as IssueService from "../../../issue/IssueService.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import {
  IssueCloseFailedError,
  IssueCommentFailedError,
  IssueLinkFailedError,
  IssueListFailedError,
  IssueOutsideThreadProjectError,
  IssueReadFailedError,
  IssueReopenFailedError,
  IssuesToolkit,
  IssueThreadNotFoundError,
  IssueUpdateFailedError,
} from "./tools.ts";

const make = Effect.gen(function* () {
  const issues = yield* IssueService.IssueService;
  const engine = yield* Orchestrator.OrchestratorV2;

  const requireThread = Effect.fn("IssuesToolkit.requireThread")(function* (
    Failure:
      | typeof IssueListFailedError
      | typeof IssueReadFailedError
      | typeof IssueCommentFailedError
      | typeof IssueCloseFailedError
      | typeof IssueReopenFailedError
      | typeof IssueUpdateFailedError
      | typeof IssueLinkFailedError,
  ) {
    const scope = yield* McpInvocationContext.requireMcpCapability("pull-requests");
    // Issue tools act inside the calling thread's own project, so an MCP client
    // signed in from outside a thread has nothing to scope to.
    const { thread: caller } = yield* Effect.gen(function* () {
      return yield* McpInvocationContext.requireThreadScope(scope, "Issue tools");
    }).pipe(Effect.mapError((cause) => new Failure({ cause })));
    const thread = yield* engine
      .getThreadShell(caller.threadId)
      .pipe(Effect.mapError((cause) => new Failure({ cause })));
    if (thread === null) {
      return yield* new IssueThreadNotFoundError({ threadId: caller.threadId });
    }
    return thread;
  });

  // Like the pull request tools, writes stay inside the calling thread's own work;
  // reads may span projects so an agent can find related issues.
  const requireOwnProject = Effect.fn("IssuesToolkit.requireOwnProject")(function* (
    Failure:
      | typeof IssueCommentFailedError
      | typeof IssueCloseFailedError
      | typeof IssueReopenFailedError
      | typeof IssueUpdateFailedError
      | typeof IssueLinkFailedError,
    projectId: string,
  ) {
    const thread = yield* requireThread(Failure);
    if (thread.projectId !== projectId) {
      return yield* new IssueOutsideThreadProjectError({ projectId });
    }
    return thread;
  });

  // Writes act on the calling thread's own project, so they need its run to be live.
  const writesOwnThread = <P, A, E, R>(handle: (params: P) => Effect.Effect<A, E, R>) =>
    McpToolAccess.writesThreads((_params: P) => [undefined], handle);

  return {
    list_issues: McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        yield* requireThread(IssueListFailedError);
        return yield* issues
          .list(input)
          .pipe(Effect.mapError((cause) => new IssueListFailedError({ cause })));
      }),
    ),
    read_issue: McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        yield* requireThread(IssueReadFailedError);
        return yield* Effect.all({
          issue: issues.detail(input),
          comments: issues.comments(input),
        }).pipe(Effect.mapError((cause) => new IssueReadFailedError({ cause })));
      }),
    ),
    comment_on_issue: writesOwnThread((input) =>
      Effect.gen(function* () {
        yield* requireOwnProject(IssueCommentFailedError, input.projectId);
        return yield* issues
          .commentCreate(input)
          .pipe(Effect.mapError((cause) => new IssueCommentFailedError({ cause })));
      }),
    ),
    close_issue: writesOwnThread((input) =>
      Effect.gen(function* () {
        yield* requireOwnProject(IssueCloseFailedError, input.projectId);
        return yield* issues
          .close(input)
          .pipe(Effect.mapError((cause) => new IssueCloseFailedError({ cause })));
      }),
    ),
    reopen_issue: writesOwnThread((input) =>
      Effect.gen(function* () {
        yield* requireOwnProject(IssueReopenFailedError, input.projectId);
        return yield* issues
          .reopen(input)
          .pipe(Effect.mapError((cause) => new IssueReopenFailedError({ cause })));
      }),
    ),
    update_issue: writesOwnThread((input) =>
      Effect.gen(function* () {
        yield* requireOwnProject(IssueUpdateFailedError, input.projectId);
        return yield* issues
          .update(input)
          .pipe(Effect.mapError((cause) => new IssueUpdateFailedError({ cause })));
      }),
    ),
    link_issue: writesOwnThread((input) =>
      Effect.gen(function* () {
        const thread = yield* requireOwnProject(IssueLinkFailedError, input.projectId);
        return yield* issues
          .link({ ...input, threadId: thread.id, source: "agent" })
          .pipe(Effect.mapError((cause) => new IssueLinkFailedError({ cause })));
      }),
    ),
  } satisfies McpToolAccess.Handlers<typeof IssuesToolkit.tools>;
});

export const IssuesToolkitHandlersLive = McpToolAccess.toLayer(IssuesToolkit, make);
