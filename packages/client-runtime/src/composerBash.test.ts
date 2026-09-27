import { describe, expect, it } from "vite-plus/test";
import { indexComposerBashCommands, parseComposerBashOutput } from "./composerBash.ts";

const activity = {
  toolCallId: "composer-bash:message-1",
  itemType: "command_execution",
  sourceActivityKind: "tool.updated",
  toolLifecycleStatus: "inProgress",
};

describe("composer Bash message results", () => {
  it("links server-confirmed commands to their exact message id", () => {
    const commands = indexComposerBashCommands([activity]);
    expect(commands.get("message-1")).toEqual({ status: "running", output: null });
    expect(commands.has("message-2")).toBe(false);
  });

  it("replaces running state with the corresponding result", () => {
    const commands = indexComposerBashCommands([
      activity,
      {
        ...activity,
        sourceActivityKind: "tool.completed",
        toolLifecycleStatus: "completed",
        detail: "Exit code: 0\nstdout:\nfile.txt",
      },
    ]);
    expect(commands.get("message-1")).toEqual({
      status: "completed",
      output: "Exit code: 0\nstdout:\nfile.txt",
    });
  });

  it("keeps failed output distinct from successful entry", () => {
    expect(
      indexComposerBashCommands([
        {
          ...activity,
          sourceActivityKind: "tool.completed",
          toolLifecycleStatus: "failed",
          detail: "Bash could not be started.",
        },
      ]).get("message-1"),
    ).toEqual({ status: "failed", output: "Bash could not be started." });
  });

  it("ignores ordinary tools and unconfirmed lifecycle states", () => {
    expect(
      indexComposerBashCommands([
        { ...activity, toolCallId: "provider-tool-1" },
        { ...activity, sourceActivityKind: "tool.started" },
        { ...activity, itemType: "file_change" },
        {
          toolCallId: activity.toolCallId,
          itemType: activity.itemType,
          sourceActivityKind: activity.sourceActivityKind,
        },
      ]).size,
    ).toBe(0);
  });
});

describe("parseComposerBashOutput", () => {
  it("splits exit code, stdout and stderr", () => {
    expect(parseComposerBashOutput("Exit code: 1\nstdout:\na\nb\nstderr:\nboom")).toEqual({
      exitCode: "1",
      stdout: "a\nb",
      stderr: "boom",
    });
    expect(parseComposerBashOutput("Exit code: 2\nstderr:\nboom")).toEqual({
      exitCode: "2",
      stdout: "",
      stderr: "boom",
    });
    expect(parseComposerBashOutput("Exit code: 0\n(no output)")).toEqual({
      exitCode: "0",
      stdout: "",
      stderr: "",
    });
    expect(parseComposerBashOutput("Bash command timed out.")).toEqual({
      exitCode: null,
      stdout: "Bash command timed out.",
      stderr: "",
    });
  });
});
