import type { OrchestrationV2PlanStep, RunId } from "@t3tools/contracts";

import type { ThreadStructureTurnItem } from "./models.ts";
import type { ThreadRunSummary, ThreadRuntimeSummary } from "./shell.ts";

export function isLatestRunSettled(
  latestRun: Pick<ThreadRunSummary, "runId" | "startedAt" | "completedAt" | "status"> | null,
  runtime: Pick<ThreadRuntimeSummary, "status" | "activeRunId"> | null,
): boolean {
  if (latestRun === null) return false;
  if (
    latestRun.status === "preparing" ||
    latestRun.status === "queued" ||
    latestRun.status === "starting" ||
    latestRun.status === "running" ||
    latestRun.status === "waiting"
  )
    return false;
  return runtime?.activeRunId !== latestRun.runId;
}

export function summarizeTodoSteps(steps: ReadonlyArray<OrchestrationV2PlanStep>) {
  const current =
    steps.find((step) => step.status === "running") ??
    steps.find((step) => step.status === "pending");
  return {
    completed: steps.filter((step) => step.status === "completed").length,
    total: steps.length,
    current: current?.text,
    position: current ? steps.indexOf(current) + 1 : null,
  };
}

export type TodoRunState = "active" | "input" | "approval" | "done" | "stopped";

export function resolveTodoRunState(input: {
  readonly settled: boolean;
  readonly completed: number;
  readonly total: number;
  readonly pendingApprovals: number;
  readonly pendingUserInputs: number;
}): TodoRunState {
  if (input.settled) return input.completed === input.total ? "done" : "stopped";
  if (input.pendingApprovals > 0) return "approval";
  if (input.pendingUserInputs > 0) return "input";
  return "active";
}

/** The agent's newest task list in the latest run; an earlier run's list says nothing about now. */
export function findLatestTodoSteps(
  projection: { readonly turnItems: ReadonlyArray<ThreadStructureTurnItem> } | null,
  latestRunId: RunId | string | null | undefined,
): ReadonlyArray<OrchestrationV2PlanStep> | null {
  if (projection === null || !latestRunId) return null;
  for (let index = projection.turnItems.length - 1; index >= 0; index -= 1) {
    const item = projection.turnItems[index];
    if (item?.type === "todo_list" && item.runId === latestRunId) {
      return item.steps.length > 0 ? item.steps : null;
    }
  }
  return null;
}
