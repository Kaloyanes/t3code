import {
  CommandId,
  MessageId,
  AutomationOperationError,
  type AutomationRun,
  type OrchestrationCommand,
  type OrchestrationProjectShell,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";

import * as AutomationService from "./AutomationService.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";

const AUTOMATION_POLL_INTERVAL = "30 seconds";
const DEFAULT_INPUT_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export class AutomationScheduler extends Context.Service<
  AutomationScheduler,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/automation/AutomationScheduler") {}

export function makeAutomationTurnStartCommand(input: {
  readonly run: AutomationRun;
  readonly project: OrchestrationProjectShell;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly commandId: CommandId;
  readonly createdAt: string;
}): OrchestrationCommand {
  const { run, project, threadId, messageId, commandId, createdAt } = input;
  return {
    type: "thread.turn.start",
    commandId,
    threadId,
    message: {
      messageId,
      role: "user",
      text: run.prompt,
      attachments: [],
    },
    modelSelection: run.execution.modelSelection,
    runtimeMode: run.execution.runtimeMode,
    interactionMode: run.execution.interactionMode,
    bootstrap: {
      createThread: {
        projectId: run.projectId,
        title: `Automation ${run.id}`,
        modelSelection: run.execution.modelSelection,
        runtimeMode: run.execution.runtimeMode,
        interactionMode: run.execution.interactionMode,
        branch: null,
        worktreePath: null,
        createdAt,
      },
      prepareWorktree: {
        projectCwd: project.workspaceRoot,
        baseBranch: run.execution.baseBranch,
        branch: `t3/automation/${run.id}`,
        requireWorktree: true,
      },
      runSetupScript: false,
    },
    createdAt,
  };
}

const make = Effect.gen(function* () {
  const automation = yield* AutomationService.AutomationService;
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const crypto = yield* Crypto.Crypto;

  const markFailed = (runId: AutomationRun["id"], cause: unknown) =>
    automation.finish({
      runId,
      status: "failed",
      reason: cause instanceof Error ? cause.message : "Scheduled run failed.",
    });

  const launch = (run: AutomationRun, now: string) =>
    Effect.gen(function* () {
      const project = yield* snapshots.getProjectShellById(run.projectId).pipe(
        Effect.mapError(
          () =>
            new AutomationOperationError({
              operation: "launch",
              detail: "The automation project could not be loaded.",
            }),
        ),
      );
      if (Option.isNone(project)) {
        yield* markFailed(run.id, new Error("The automation project no longer exists."));
        return;
      }
      const threadId = ThreadId.make(yield* crypto.randomUUIDv4);
      const messageId = MessageId.make(yield* crypto.randomUUIDv4);
      const commandId = CommandId.make(`server:automation:${run.id}`);
      const command = makeAutomationTurnStartCommand({
        run,
        project: project.value,
        threadId,
        messageId,
        commandId,
        createdAt: now,
      });
      yield* engine.dispatch(command).pipe(
        Effect.tap(() => automation.attachThread({ runId: run.id, threadId, worktreePath: null })),
        Effect.catchCause((cause) => markFailed(run.id, cause)),
      );
    });

  const reconcile = (nowMs: number) =>
    Effect.gen(function* () {
      const snapshot = yield* automation.getSnapshot();
      const shell = yield* snapshots.getShellSnapshot();
      const threads = new Map(shell.threads.map((thread) => [String(thread.id), thread] as const));
      yield* Effect.forEach(
        snapshot.runs.filter(
          (run) =>
            (run.status === "running" || run.status === "waiting-for-input") &&
            run.threadId !== null,
        ),
        (run) => {
          const thread = threads.get(String(run.threadId));
          if (thread === undefined) return Effect.void;
          if (thread.session?.status === "error") {
            return automation.finish({
              runId: run.id,
              status: "failed",
              reason: thread.session.lastError ?? "The provider session failed.",
            });
          }
          if (thread.latestTurn?.state === "completed") {
            return automation.finish({ runId: run.id, status: "completed" });
          }
          if (thread.latestTurn?.state === "error") {
            return automation.finish({
              runId: run.id,
              status: "failed",
              reason: "The agent turn failed.",
            });
          }
          if (thread.latestTurn?.state === "interrupted") {
            return automation.finish({
              runId: run.id,
              status: "canceled",
              reason: "The agent turn was interrupted.",
            });
          }
          if (thread.hasPendingApprovals || thread.hasPendingUserInput) {
            return run.status === "running" ? automation.markWaiting(run.id) : Effect.void;
          }
          if (run.status === "waiting-for-input") {
            if (
              run.startedAt !== null &&
              nowMs - Date.parse(run.startedAt) >
                (run.execution.inputTimeoutMs ?? DEFAULT_INPUT_TIMEOUT_MS)
            ) {
              return automation.finish({
                runId: run.id,
                status: "failed",
                reason: "Timed out waiting for input.",
              });
            }
            return automation.markRunning(run.id);
          }
          return Effect.void;
        },
        { discard: true, concurrency: 4 },
      );
    });

  const tick = Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const now = DateTime.formatIso(yield* DateTime.now);
    const runs = yield* automation.claimDue(nowMs);
    yield* Effect.forEach(runs, (run) => launch(run, now), {
      discard: true,
      concurrency: 1,
    });
    yield* reconcile(nowMs);
  }).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.logWarning("scheduled automation tick failed", { cause: Cause.pretty(cause) }),
    ),
  );

  const start = Effect.fn("AutomationScheduler.start")(function* () {
    yield* tick.pipe(Effect.repeat(Schedule.spaced(AUTOMATION_POLL_INTERVAL)), Effect.forkScoped);
  });

  return { start };
});

export const layer = Layer.effect(AutomationScheduler, make);
