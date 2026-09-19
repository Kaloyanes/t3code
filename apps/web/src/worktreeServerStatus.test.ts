import { ThreadId, type DiscoveredLocalServer } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveProjectScriptRunStates, resolveWorktreeServerPorts } from "./worktreeServerStatus";

const server = (port: number, threadId: string, terminalId: string): DiscoveredLocalServer => ({
  host: "localhost",
  port,
  url: `http://localhost:${port}`,
  processName: "node",
  pid: port,
  terminal: { threadId: ThreadId.make(threadId), terminalId },
});

describe("worktree server status", () => {
  it("sorts the ports owned by a worktree's threads and ignores other worktrees", () => {
    expect(
      resolveWorktreeServerPorts({
        servers: [server(5173, "thread-b", "term-2"), server(3000, "thread-a", "term-1")],
        threadIds: new Set(["thread-a"]),
      }),
    ).toEqual([3000]);
  });

  it("deduplicates and sorts multiple servers for one worktree", () => {
    expect(
      resolveWorktreeServerPorts({
        servers: [
          server(5173, "thread-a", "term-2"),
          server(3000, "thread-a", "term-1"),
          server(5173, "thread-a", "term-2"),
        ],
        threadIds: new Set(["thread-a"]),
      }),
    ).toEqual([3000, 5173]);
  });

  it("moves a worktree action from starting to running when its terminal owns a port", () => {
    expect(
      resolveProjectScriptRunStates({
        runs: [
          { scriptId: "dev", terminalId: "term-1", scope: "worktree" },
          { scriptId: "build", terminalId: "term-2", scope: "thread" },
        ],
        servers: [server(3000, "thread-a", "term-1")],
      }),
    ).toEqual({ startingScriptIds: ["build"], runningScriptIds: ["dev"] });
  });
});
