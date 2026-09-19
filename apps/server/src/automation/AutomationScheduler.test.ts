import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  AutomationRun,
  CommandId,
  MessageId,
  OrchestrationProjectShell,
  ProviderInstanceId,
  ThreadId,
  ThreadTurnStartCommand,
} from "@t3tools/contracts";

import { makeAutomationTurnStartCommand } from "./AutomationScheduler.ts";

const decodeRun = Schema.decodeUnknownSync(AutomationRun);
const decodeProject = Schema.decodeUnknownSync(OrchestrationProjectShell);
const decodeCommand = Schema.decodeUnknownSync(ThreadTurnStartCommand);

describe("makeAutomationTurnStartCommand", () => {
  it("starts a fresh dedicated worktree with the run snapshot", () => {
    const run = decodeRun({
      id: "run-1",
      automationId: "automation-1",
      projectId: "project-1",
      threadId: null,
      trigger: "schedule",
      prompt: "Run the repository checks and summarize failures.",
      execution: {
        modelSelection: { instanceId: "codex", model: "gpt-5" },
        baseBranch: "main",
      },
      scheduledAt: "2026-09-20T09:30:00.000Z",
      status: "running",
      startedAt: "2026-09-20T09:30:01.000Z",
      completedAt: null,
      lateByMs: 1_000,
      reason: null,
    });
    const project = decodeProject({
      id: "project-1",
      title: "T3 Code",
      workspaceRoot: "/workspace/t3-code",
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-09-20T09:00:00.000Z",
      updatedAt: "2026-09-20T09:00:00.000Z",
    });
    const command = decodeCommand(
      makeAutomationTurnStartCommand({
        run,
        project,
        threadId: ThreadId.make("thread-1"),
        messageId: MessageId.make("message-1"),
        commandId: CommandId.make("command-1"),
        createdAt: "2026-09-20T09:30:01.000Z",
      }),
    );

    expect(command.message.text).toBe(run.prompt);
    expect(command.modelSelection?.instanceId).toBe(ProviderInstanceId.make("codex"));
    expect(command.bootstrap?.prepareWorktree).toEqual({
      projectCwd: project.workspaceRoot,
      baseBranch: "main",
      branch: "t3/automation/run-1",
      requireWorktree: true,
    });
    expect(command.bootstrap?.createThread?.worktreePath).toBeNull();
  });
});
