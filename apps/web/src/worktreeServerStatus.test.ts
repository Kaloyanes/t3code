import { ProjectId, ThreadId, type DiscoveredLocalServer } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveProjectScriptRunStates,
  resolveWorktreeServers,
  resolveWorktreeServerPorts,
} from "./worktreeServerStatus";

const server = (port: number, threadId: string, terminalId: string): DiscoveredLocalServer => ({
  host: "localhost",
  port,
  url: `http://localhost:${port}`,
  processName: "node",
  pid: port,
  terminal: { threadId: ThreadId.make(threadId), terminalId },
});

describe("worktree server status", () => {
  it("finds a worktree-run server without relying on an owning thread", () => {
    const workspaceServer: DiscoveredLocalServer = {
      ...server(5173, "old-thread", "term-1"),
      terminal: null,
      worktreeRun: {
        projectId: ProjectId.make("project-1"),
        workspacePath: "/repo/worktree",
        scriptId: "dev",
      },
    };
    expect(
      resolveWorktreeServers({
        servers: [workspaceServer],
        projectId: "project-1",
        workspacePath: "/repo/worktree",
        threadIds: new Set(),
      }),
    ).toEqual([workspaceServer]);
  });
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

  it("returns only workspace servers with their terminal ownership intact", () => {
    const workspaceServers = resolveWorktreeServers({
      servers: [server(5173, "thread-b", "term-3"), server(3000, "thread-a", "term-2")],
      threadIds: new Set(["thread-a"]),
    });

    expect(workspaceServers).toEqual([server(3000, "thread-a", "term-2")]);
    expect(workspaceServers[0]?.terminal).toEqual({
      threadId: ThreadId.make("thread-a"),
      terminalId: "term-2",
    });
  });

  it("returns no server actions when the workspace has no owned servers", () => {
    expect(
      resolveWorktreeServers({
        servers: [server(5173, "other-thread", "term-2")],
        threadIds: new Set(["thread-a"]),
      }),
    ).toEqual([]);
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
