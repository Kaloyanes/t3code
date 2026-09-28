import { describe, expect, it } from "vite-plus/test";
import { ProjectId, type WorktreeRunSnapshot } from "@t3tools/contracts";
import { applyWorktreeRunAttachEvent } from "./worktreeRun.ts";
import {
  DEFAULT_MAX_TERMINAL_BUFFER_BYTES,
  INITIAL_TERMINAL_OUTPUT_CURSOR,
  readTerminalOutputUpdate,
  terminalOutputText,
} from "./terminalOutput.ts";

const target = {
  projectId: ProjectId.make("project"),
  workspacePath: "/workspace",
  scriptId: "dev",
};
const snapshot: WorktreeRunSnapshot = {
  target,
  name: "Dev",
  command: "vp dev",
  status: "running",
  pid: 123,
  history: "ready\r\n",
  exitCode: null,
  exitSignal: null,
  label: "Dev",
  updatedAt: "2026-09-28T00:00:00Z",
};

describe("workspace run output", () => {
  it("replays retained output on attach and resets on reconnect even with identical history", () => {
    const first = applyWorktreeRunAttachEvent(null, { type: "snapshot", snapshot })!;
    const initial = readTerminalOutputUpdate(first.output, INITIAL_TERMINAL_OUTPUT_CURSOR);
    expect(initial).toMatchObject({ type: "reset", data: snapshot.history });
    const reconnected = applyWorktreeRunAttachEvent(null, { type: "snapshot", snapshot })!;
    expect(readTerminalOutputUpdate(reconnected.output, initial.cursor)).toMatchObject({
      type: "reset",
      data: snapshot.history,
    });
  });

  it("bounds retained history while delivering new chunks without resetting an up-to-date viewport", () => {
    const first = applyWorktreeRunAttachEvent(null, {
      type: "snapshot",
      snapshot: { ...snapshot, history: "a".repeat(DEFAULT_MAX_TERMINAL_BUFFER_BYTES) },
    })!;
    const cursor = readTerminalOutputUpdate(first.output, INITIAL_TERMINAL_OUTPUT_CURSOR).cursor;
    const next = applyWorktreeRunAttachEvent(first, { type: "output", target, data: "next\r\n" })!;
    expect(next.output.retainedBytes).toBeLessThanOrEqual(DEFAULT_MAX_TERMINAL_BUFFER_BYTES);
    expect(readTerminalOutputUpdate(next.output, cursor)).toMatchObject({
      type: "append",
      data: "next\r\n",
    });
    expect(next).not.toHaveProperty("history");
  });

  it("clears output explicitly and preserves stopped and exited output", () => {
    const first = applyWorktreeRunAttachEvent(null, { type: "snapshot", snapshot })!;
    const stopped = applyWorktreeRunAttachEvent(first, { type: "stopped", target })!;
    expect(stopped.status).toBe("stopped");
    expect(terminalOutputText(stopped.output)).toBe(snapshot.history);
    const exited = applyWorktreeRunAttachEvent(first, {
      type: "exited",
      target,
      exitCode: 1,
      exitSignal: null,
    })!;
    expect(exited).toMatchObject({ status: "exited", exitCode: 1, pid: null });
    expect(terminalOutputText(exited.output)).toBe(snapshot.history);
    const cursor = readTerminalOutputUpdate(stopped.output, INITIAL_TERMINAL_OUTPUT_CURSOR).cursor;
    const cleared = applyWorktreeRunAttachEvent(stopped, { type: "cleared", target })!;
    expect(readTerminalOutputUpdate(cleared.output, cursor)).toMatchObject({
      type: "reset",
      data: "",
    });
  });
});
