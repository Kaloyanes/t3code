import { describe, expect, it } from "vite-plus/test";
import { indexComposerBashCommands } from "./composerBash.ts";

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
