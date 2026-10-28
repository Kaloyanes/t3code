import type { OrchestrationV2PlanStep } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  presentThreadProgress,
  presentThreadProgressStep,
  withProgressCount,
} from "./thread-progress-presentation";

const steps: ReadonlyArray<OrchestrationV2PlanStep> = [
  { id: "a", text: "Read the code", status: "completed" },
  { id: "b", text: "Write the fix", status: "running" },
  { id: "c", text: "Run the tests", status: "pending" },
];

describe("thread progress presentation", () => {
  it("names the current step and says what a blocked run waits on", () => {
    expect(presentThreadProgress(steps, "active")).toMatchObject({
      title: "Write the fix",
      description: "1/3",
      tone: "active",
    });
    expect(presentThreadProgress(steps, "input")).toMatchObject({
      description: "1/3 · Waiting for your answer",
      tone: "waiting",
    });
    expect(presentThreadProgress(steps, "approval").description).toBe(
      "1/3 · Waiting for your approval",
    );
    expect(presentThreadProgress(steps, "stopped")).toMatchObject({
      title: "Write the fix",
      count: "1/3",
      description: "1/3 · Stopped",
      summary: "Stopped · 1 of 3",
    });
    expect(
      presentThreadProgress(steps, "active").segments?.map((segment) => segment.status),
    ).toEqual(["completed", "running", "pending"]);
    expect(
      presentThreadProgress(
        Array.from({ length: 13 }, (_, index) => ({
          id: String(index),
          text: "Step",
          status: "pending" as const,
        })),
        "active",
      ).segments,
    ).toBeNull();
    expect(
      presentThreadProgress(
        steps.map((s) => ({ ...s, status: "completed" })),
        "done",
      ),
    ).toMatchObject({
      title: "All steps done",
      tone: "done",
    });
  });

  it("shows the running step as blocked or stalled instead of moving", () => {
    const running = steps[1]!;
    expect(presentThreadProgressStep(running, "active")).toMatchObject({
      icon: "circle.inset.filled",
      note: "In progress",
      highlight: true,
    });
    expect(presentThreadProgressStep(running, "input")).toMatchObject({
      icon: "questionmark.bubble",
      note: "Waiting for your answer",
    });
    expect(presentThreadProgressStep(running, "approval").icon).toBe("exclamationmark.shield");
    expect(presentThreadProgressStep(running, "stopped")).toMatchObject({
      icon: "circle.dashed",
      tone: "muted",
      highlight: false,
    });
    expect(presentThreadProgressStep(steps[0]!, "active").strike).toBe(true);
  });

  it("keeps the step count on working and blocked rows only", () => {
    const progress = { completed: 2, total: 5 };
    expect(withProgressCount("working", "Working", progress)).toBe("Working 2/5");
    expect(withProgressCount("input", "Input", progress)).toBe("Input 2/5");
    expect(withProgressCount("approval", "Approval", progress)).toBe("Approval 2/5");
    expect(withProgressCount("failed", "Failed", progress)).toBe("Failed");
    expect(withProgressCount("working", "Working", null)).toBe("Working");
  });
});
