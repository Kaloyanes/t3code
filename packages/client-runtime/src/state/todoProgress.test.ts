import { NodeId, PlanId, RunId, ThreadId, TurnItemId } from "@t3tools/contracts";
import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  findLatestTodoSteps,
  isLatestRunSettled,
  resolveTodoRunState,
  summarizeTodoSteps,
} from "./todoProgress.ts";

describe("todo progress", () => {
  it("uses run status as the settlement boundary", () => {
    const runId = RunId.make("run-1");
    expect(
      isLatestRunSettled(
        {
          runId,
          status: "completed",
          startedAt: "2026-06-20T00:00:00.000Z",
          completedAt: "2026-06-20T00:01:00.000Z",
        },
        null,
      ),
    ).toBe(true);
    expect(
      isLatestRunSettled(
        { runId, status: "running", startedAt: null, completedAt: null },
        { status: "running", activeRunId: runId },
      ),
    ).toBe(false);
    expect(
      isLatestRunSettled(
        { runId, status: "queued", startedAt: null, completedAt: null },
        { status: "running", activeRunId: RunId.make("run-active") },
      ),
    ).toBe(false);
  });

  it("reads progress from the newest todo list of the latest run only", () => {
    const now = DateTime.makeUnsafe("2026-09-04T00:00:00.000Z");
    const todoItem = (id: string, runId: string, ordinal: number, texts: ReadonlyArray<string>) =>
      ({
        id: TurnItemId.make(id),
        threadId: ThreadId.make("thread-todo"),
        runId: RunId.make(runId),
        nodeId: NodeId.make(`node-${id}`),
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal,
        status: "completed" as const,
        title: null,
        startedAt: now,
        completedAt: now,
        updatedAt: now,
        type: "todo_list" as const,
        planId: PlanId.make(`plan-${id}`),
        steps: texts.map((text, index) => ({
          id: `step-${index + 1}`,
          text,
          status: index === 0 ? ("completed" as const) : ("pending" as const),
        })),
      }) satisfies OrchestrationV2TurnItem;
    const projection = {
      turnItems: [
        todoItem("old-run", "run-old", 0, ["Old"]),
        todoItem("first", "run-now", 1, ["A", "B"]),
        todoItem("latest", "run-now", 2, ["A", "B", "C"]),
        todoItem("empty", "run-empty", 3, []),
      ],
    };

    expect(findLatestTodoSteps(projection, "run-now")?.map((step) => step.text)).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(findLatestTodoSteps(projection, "run-other")).toBeNull();
    expect(findLatestTodoSteps(projection, "run-empty")).toBeNull();
    expect(findLatestTodoSteps(projection, null)).toBeNull();
    expect(summarizeTodoSteps(findLatestTodoSteps(projection, "run-now") ?? [])).toEqual({
      completed: 1,
      total: 3,
      current: "B",
      position: 2,
    });
  });

  it("tells a stopped task list from a finished or blocked one", () => {
    const run = { completed: 1, total: 3, pendingApprovals: 0, pendingUserInputs: 0 };
    expect(resolveTodoRunState({ ...run, settled: false })).toBe("active");
    expect(resolveTodoRunState({ ...run, settled: false, pendingUserInputs: 1 })).toBe("input");
    expect(
      resolveTodoRunState({ ...run, settled: false, pendingUserInputs: 1, pendingApprovals: 1 }),
    ).toBe("approval");
    expect(resolveTodoRunState({ ...run, settled: true, pendingUserInputs: 1 })).toBe("stopped");
    expect(resolveTodoRunState({ ...run, settled: true, completed: 3 })).toBe("done");
  });
});
