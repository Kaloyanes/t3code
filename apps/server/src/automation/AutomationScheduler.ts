import {
  CommandId,
  MessageId,
  type AutomationRun,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";

import * as AutomationService from "./AutomationService.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";

const AUTOMATION_POLL_INTERVAL = "30 seconds";
const DEFAULT_INPUT_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export class AutomationScheduler extends Context.Service<
  AutomationScheduler,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/automation/AutomationScheduler") {}

/** One automation run launches a fresh thread, in its own worktree unless disabled. */
export function makeAutomationLaunchInput(run: AutomationRun): ThreadLaunch.ThreadLaunchInput {
  return {
    commandId: CommandId.make(`server:automation:${run.id}`),
    projectId: run.projectId,
    title: `Automation ${run.id}`,
    modelSelection: run.execution.modelSelection,
    runtimeMode: run.execution.runtimeMode,
    interactionMode: run.execution.interactionMode,
    workspaceStrategy:
      run.execution.worktreePolicy === "dedicated"
        ? {
            type: "worktree",
            baseRef: run.execution.baseBranch,
            branch: `t3/automation/${run.id}`,
          }
        : { type: "root" },
    initialMessage: {
      messageId: MessageId.make(`automation-message:${run.id}`),
      text: run.prompt,
      attachments: [],
    },
    createdBy: "user",
    creationSource: "server",
  };
}

export type AutomationRunOutcome =
  | {
      readonly type: "finish";
      readonly status: "completed" | "failed" | "canceled";
      readonly reason?: string;
    }
  | { readonly type: "waiting" }
  | { readonly type: "running" }
  | { readonly type: "none" };

/** How an in-flight automation run reads from its thread's current shell. */
export function automationRunOutcome(
  run: AutomationRun,
  thread: Pick<
    OrchestrationV2ThreadShell,
    "status" | "activeRunId" | "latestRunId" | "lastError" | "pendingRuntimeRequest"
  >,
  nowMs: number,
): AutomationRunOutcome {
  if (thread.activeRunId === null && thread.latestRunId !== null) {
    switch (thread.status) {
      case "completed":
        return { type: "finish", status: "completed" };
      case "failed":
        return {
          type: "finish",
          status: "failed",
          reason: thread.lastError ?? "The agent turn failed.",
        };
      case "interrupted":
      case "cancelled":
        return { type: "finish", status: "canceled", reason: "The agent turn was interrupted." };
    }
  }
  if (
    run.status === "running" &&
    run.startedAt !== null &&
    run.execution.timeoutMs !== undefined &&
    nowMs - Date.parse(run.startedAt) > run.execution.timeoutMs
  ) {
    return { type: "finish", status: "failed", reason: "Timed out during agent execution." };
  }
  if (thread.pendingRuntimeRequest !== null) {
    return run.status === "running" ? { type: "waiting" } : { type: "none" };
  }
  if (run.status === "waiting-for-input") {
    if (
      run.startedAt !== null &&
      nowMs - Date.parse(run.startedAt) > (run.execution.inputTimeoutMs ?? DEFAULT_INPUT_TIMEOUT_MS)
    ) {
      return { type: "finish", status: "failed", reason: "Timed out waiting for input." };
    }
    return { type: "running" };
  }
  return { type: "none" };
}

const make = Effect.gen(function* () {
  const automation = yield* AutomationService.AutomationService;
  const threadLaunch = yield* ThreadLaunch.ThreadLaunchService;
  const threads = yield* ThreadManagement.ThreadManagementService;

  const launch = (run: AutomationRun) =>
    threadLaunch.launch(makeAutomationLaunchInput(run)).pipe(
      Effect.flatMap((result) =>
        automation.attachThread({
          runId: run.id,
          threadId: result.threadId,
          worktreePath: result.projection.thread.worktreePath,
        }),
      ),
      Effect.catchCause((cause) => {
        const error = Cause.squash(cause);
        return automation.finish({
          runId: run.id,
          status: "failed",
          reason: error instanceof Error ? error.message : "Scheduled run failed.",
        });
      }),
    );

  const reconcile = (nowMs: number) =>
    Effect.gen(function* () {
      const snapshot = yield* automation.getSnapshot();
      const shell = yield* threads.getShellSnapshot();
      const byId = new Map(shell.threads.map((thread) => [String(thread.id), thread] as const));
      yield* Effect.forEach(
        snapshot.runs.filter(
          (run) =>
            (run.status === "running" || run.status === "waiting-for-input") &&
            run.threadId !== null,
        ),
        (run) => {
          const thread = byId.get(String(run.threadId));
          if (thread === undefined) return Effect.void;
          const outcome = automationRunOutcome(run, thread, nowMs);
          switch (outcome.type) {
            case "finish":
              return automation.finish({
                runId: run.id,
                status: outcome.status,
                ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
              });
            case "waiting":
              return automation.markWaiting(run.id);
            case "running":
              return automation.markRunning(run.id);
            case "none":
              return Effect.void;
          }
        },
        { discard: true, concurrency: 4 },
      );
    });

  const tick = Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const runs = yield* automation.claimDue(nowMs);
    yield* Effect.forEach(runs, launch, { discard: true, concurrency: 1 });
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
