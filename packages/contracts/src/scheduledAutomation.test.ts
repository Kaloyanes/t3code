import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  Automation,
  AutomationExecution,
  AutomationRun,
  AutomationSchedule,
} from "./scheduledAutomation.ts";

const decodeAutomationSchedule = Schema.decodeUnknownSync(AutomationSchedule);
const decodeAutomationExecution = Schema.decodeUnknownSync(AutomationExecution);
const decodeAutomation = Schema.decodeUnknownSync(Automation);
const decodeAutomationRun = Schema.decodeUnknownSync(AutomationRun);

describe("AutomationSchedule", () => {
  it("accepts a weekly wall-clock schedule", () => {
    expect(
      decodeAutomationSchedule({
        kind: "weekly",
        days: ["monday", "friday"],
        time: "09:30",
        timeZone: "Europe/Sofia",
      }),
    ).toEqual({
      kind: "weekly",
      days: ["monday", "friday"],
      time: "09:30",
      timeZone: "Europe/Sofia",
    });
  });

  it("rejects malformed local times and empty weekday lists", () => {
    expect(() =>
      decodeAutomationSchedule({
        kind: "daily",
        time: "25:00",
        timeZone: "UTC",
      }),
    ).toThrow();

    expect(() =>
      decodeAutomationSchedule({
        kind: "weekly",
        days: [],
        time: "09:30",
        timeZone: "UTC",
      }),
    ).toThrow();
  });
});

describe("AutomationExecution", () => {
  it("defaults scheduled work to approval-required execution", () => {
    expect(
      decodeAutomationExecution({
        modelSelection: { instanceId: "codex", model: "gpt-5.6" },
        baseBranch: "main",
      }),
    ).toMatchObject({
      runtimeMode: "approval-required",
      interactionMode: "default",
      worktreePolicy: "dedicated",
    });
  });
});

describe("Automation and AutomationRun", () => {
  const execution = {
    modelSelection: { instanceId: "codex", model: "gpt-5.6" },
    baseBranch: "main",
  };

  it("keeps the automation lifecycle and next run separate from run history", () => {
    const automation = decodeAutomation({
      id: "automation-1",
      projectId: "project-1",
      name: "Daily health check",
      prompt: "Run the repository health checks and summarize failures.",
      schedule: { kind: "daily", time: "09:30", timeZone: "UTC" },
      execution,
      status: "active",
      nextRunAt: "2026-09-21T09:30:00.000Z",
      lastRunId: null,
      createdAt: "2026-09-20T08:00:00.000Z",
      updatedAt: "2026-09-20T08:00:00.000Z",
    });

    expect(automation.status).toBe("active");
    expect(automation.nextRunAt).toBe("2026-09-21T09:30:00.000Z");
    expect(automation.lastRunId).toBeNull();
  });

  it("stores a run's immutable prompt and execution snapshot", () => {
    const run = decodeAutomationRun({
      id: "run-1",
      automationId: "automation-1",
      projectId: "project-1",
      threadId: null,
      trigger: "schedule",
      prompt: "Run the repository health checks and summarize failures.",
      execution,
      scheduledAt: "2026-09-21T09:30:00.000Z",
      status: "scheduled",
      startedAt: null,
      completedAt: null,
      lateByMs: 0,
      reason: null,
    });

    expect(run.status).toBe("scheduled");
    expect(run.execution.worktreePolicy).toBe("dedicated");
  });
});
