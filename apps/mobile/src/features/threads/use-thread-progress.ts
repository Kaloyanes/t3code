import {
  findLatestTodoSteps,
  isLatestRunSettled,
  resolveTodoRunState,
  summarizeTodoSteps,
} from "@t3tools/client-runtime/state/todo-progress";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { OrchestrationV2PlanStep, ScopedThreadRef } from "@t3tools/contracts";

import { useQuietThreadStructure } from "../../state/use-thread-detail";

/** The latest run's task list while the run is live; null when there is nothing to show. */
export function useThreadProgress(input: {
  readonly threadRef: ScopedThreadRef | null;
  readonly thread: Pick<EnvironmentThreadShell, "latestRun" | "runtime">;
  readonly hasPendingApproval: boolean;
  readonly hasPendingUserInput: boolean;
}) {
  const structure = useQuietThreadStructure(input.threadRef);
  const steps: ReadonlyArray<OrchestrationV2PlanStep> | null = findLatestTodoSteps(
    structure === null ? null : structure.projection,
    input.thread.latestRun?.runId ?? null,
  );
  if (steps === null || isLatestRunSettled(input.thread.latestRun, input.thread.runtime)) {
    return null;
  }
  const { completed, total } = summarizeTodoSteps(steps);
  const state = resolveTodoRunState({
    settled: false,
    completed,
    total,
    pendingApprovals: input.hasPendingApproval ? 1 : 0,
    pendingUserInputs: input.hasPendingUserInput ? 1 : 0,
  });
  return { steps, state };
}
