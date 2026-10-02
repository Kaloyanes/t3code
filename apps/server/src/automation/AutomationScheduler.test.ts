import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { AutomationRun, RunId } from "@t3tools/contracts";

import { automationRunOutcome, makeAutomationLaunchInput } from "./AutomationScheduler.ts";

const decodeRun = Schema.decodeUnknownSync(AutomationRun);

const makeRun = (execution: Record<string, unknown> = {}, status = "running") =>
  decodeRun({
    id: "run-1",
    automationId: "automation-1",
    projectId: "project-1",
    threadId: "thread-1",
    trigger: "schedule",
    prompt: "Run the repository checks and summarize failures.",
    execution: {
      modelSelection: { instanceId: "codex", model: "gpt-5" },
      baseBranch: "main",
      ...execution,
    },
    scheduledAt: "2026-09-20T09:30:00.000Z",
    status,
    startedAt: "2026-09-20T09:30:01.000Z",
    completedAt: null,
    lateByMs: 1_000,
    reason: null,
  });

const STARTED_MS = Date.parse("2026-09-20T09:30:01.000Z");
const idleThread = {
  status: "idle" as const,
  activeRunId: null,
  latestRunId: null,
  lastError: null,
  pendingRuntimeRequest: null,
};

describe("makeAutomationLaunchInput", () => {
  it("launches a fresh dedicated worktree with the run snapshot", () => {
    const run = makeRun();
    const input = makeAutomationLaunchInput(run);
    expect(input.initialMessage?.text).toBe(run.prompt);
    expect(input.workspaceStrategy).toEqual({
      type: "worktree",
      baseRef: "main",
      branch: "t3/automation/run-1",
    });
    expect(input.creationSource).toBe("server");
  });

  it("launches in the project checkout when dedicated worktrees are disabled", () => {
    const input = makeAutomationLaunchInput(makeRun({ worktreePolicy: "current-checkout" }));
    expect(input.workspaceStrategy).toEqual({ type: "root" });
  });
});

describe("automationRunOutcome", () => {
  const ended = (status: "completed" | "failed" | "interrupted") => ({
    ...idleThread,
    status,
    latestRunId: RunId.make("run"),
    lastError: status === "failed" ? "Provider crashed" : null,
  });

  it("settles the run from the thread's finished run", () => {
    expect(automationRunOutcome(makeRun(), ended("completed"), STARTED_MS)).toEqual({
      type: "finish",
      status: "completed",
    });
    expect(automationRunOutcome(makeRun(), ended("failed"), STARTED_MS)).toEqual({
      type: "finish",
      status: "failed",
      reason: "Provider crashed",
    });
    expect(automationRunOutcome(makeRun(), ended("interrupted"), STARTED_MS)).toMatchObject({
      status: "canceled",
    });
  });

  it("waits on pending requests and times out runs that exceed their limits", () => {
    const waiting = {
      ...idleThread,
      status: "waiting" as const,
      activeRunId: RunId.make("run"),
      pendingRuntimeRequest: {
        id: "request" as never,
        kind: "approval" as never,
        createdAt: DateTime.makeUnsafe(STARTED_MS),
      },
    };
    expect(automationRunOutcome(makeRun(), waiting, STARTED_MS)).toEqual({ type: "waiting" });
    expect(
      automationRunOutcome(makeRun({ timeoutMs: 1_000 }), idleThread, STARTED_MS + 5_000),
    ).toMatchObject({ type: "finish", reason: "Timed out during agent execution." });
    expect(
      automationRunOutcome(
        makeRun({ inputTimeoutMs: 1_000 }, "waiting-for-input"),
        idleThread,
        STARTED_MS + 5_000,
      ),
    ).toMatchObject({ type: "finish", reason: "Timed out waiting for input." });
  });
});
