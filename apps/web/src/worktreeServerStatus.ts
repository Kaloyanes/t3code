import type { DiscoveredLocalServer, ProjectScript } from "@t3tools/contracts";

export interface TrackedProjectScriptRun {
  readonly scriptId: string;
  readonly terminalId: string;
  readonly scope: ProjectScript["scope"];
}

export function resolveWorktreeServerPorts(input: {
  readonly servers: ReadonlyArray<DiscoveredLocalServer>;
  readonly threadIds: ReadonlySet<string>;
}): ReadonlyArray<number> {
  return [
    ...new Set(
      input.servers
        .filter(
          (server) => server.terminal !== null && input.threadIds.has(server.terminal.threadId),
        )
        .map((server) => server.port),
    ),
  ].sort((left, right) => left - right);
}

export function resolveProjectScriptRunStates(input: {
  readonly runs: ReadonlyArray<TrackedProjectScriptRun>;
  readonly servers: ReadonlyArray<DiscoveredLocalServer>;
}): {
  readonly startingScriptIds: ReadonlyArray<string>;
  readonly runningScriptIds: ReadonlyArray<string>;
} {
  const serverTerminalIds = new Set(
    input.servers.flatMap((server) =>
      server.terminal === null ? [] : [server.terminal.terminalId],
    ),
  );
  const startingScriptIds: string[] = [];
  const runningScriptIds: string[] = [];
  for (const run of input.runs) {
    if (run.scope === "worktree" && serverTerminalIds.has(run.terminalId)) {
      runningScriptIds.push(run.scriptId);
    } else {
      startingScriptIds.push(run.scriptId);
    }
  }
  return {
    startingScriptIds: startingScriptIds.toSorted(),
    runningScriptIds: runningScriptIds.toSorted(),
  };
}
