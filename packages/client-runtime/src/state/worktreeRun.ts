import type {
  WorktreeRunAttachEvent,
  WorktreeRunMetadataEvent,
  WorktreeRunSnapshot,
  WorktreeRunSummary,
} from "@t3tools/contracts";
import { WS_METHODS } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { subscribe, type EnvironmentRpcInput } from "../rpc/client.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentSubscriptionAtomFamily,
} from "./runtime.ts";
import { nextTerminalAttachSeedState } from "./terminalSession.ts";
import {
  appendOutput,
  DEFAULT_MAX_TERMINAL_BUFFER_BYTES,
  resetOutput,
  type TerminalOutputState,
} from "./terminalOutput.ts";

export interface WorktreeRunState extends Omit<WorktreeRunSnapshot, "history"> {
  readonly output: TerminalOutputState;
  readonly version: number;
}

const key = (target: { projectId: string; workspacePath: string; scriptId: string }) =>
  JSON.stringify([target.projectId, target.workspacePath, target.scriptId]);

export function applyWorktreeRunMetadataEvent(
  current: ReadonlyArray<WorktreeRunSummary>,
  event: WorktreeRunMetadataEvent,
): ReadonlyArray<WorktreeRunSummary> {
  if (event.type === "snapshot") return event.runs;
  if (event.type === "remove")
    return current.filter((run) => key(run.target) !== key(event.target));
  return [...current.filter((run) => key(run.target) !== key(event.run.target)), event.run];
}

export function applyWorktreeRunAttachEvent(
  current: WorktreeRunState | null,
  event: WorktreeRunAttachEvent,
): WorktreeRunState | null {
  if (event.type === "snapshot") {
    const { history, ...snapshot } = event.snapshot;
    return {
      ...snapshot,
      output: resetOutput(
        current?.output ?? nextTerminalAttachSeedState().output,
        history,
        DEFAULT_MAX_TERMINAL_BUFFER_BYTES,
      ),
      version: (current?.version ?? 0) + 1,
    };
  }
  if (!current) return null;
  const next = { ...current, version: current.version + 1 };
  if (event.type === "output")
    return {
      ...next,
      output: appendOutput(current.output, event.data, DEFAULT_MAX_TERMINAL_BUFFER_BYTES),
    };
  if (event.type === "cleared")
    return {
      ...next,
      output: resetOutput(current.output, "", DEFAULT_MAX_TERMINAL_BUFFER_BYTES),
    };
  if (event.type === "exited") {
    return {
      ...next,
      status: "exited",
      pid: null,
      exitCode: event.exitCode,
      exitSignal: event.exitSignal,
    };
  }
  return { ...next, status: "stopped", pid: null };
}

export function createWorktreeRunEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const lifecycle = createAtomCommandScheduler();
  const targetKey = ({
    environmentId,
    input,
  }: {
    environmentId: string;
    input: { projectId: string; workspacePath: string; scriptId: string };
  }) => JSON.stringify([environmentId, input.projectId, input.workspacePath, input.scriptId]);
  return {
    metadata: createEnvironmentSubscriptionAtomFamily(runtime, {
      label: "environment-data:worktree-runs:metadata",
      subscribe: (_input: null) =>
        subscribe(WS_METHODS.subscribeWorktreeRuns, {}).pipe(
          Stream.scan((): ReadonlyArray<WorktreeRunSummary> => [], applyWorktreeRunMetadataEvent),
        ),
    }),
    attach: createEnvironmentSubscriptionAtomFamily(runtime, {
      label: "environment-data:worktree-runs:attach",
      subscribe: (input: EnvironmentRpcInput<typeof WS_METHODS.worktreeRunAttach>) =>
        subscribe(WS_METHODS.worktreeRunAttach, input).pipe(
          Stream.scan((): WorktreeRunState | null => null, applyWorktreeRunAttachEvent),
        ),
    }),
    start: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:worktree-runs:start",
      tag: WS_METHODS.worktreeRunStart,
      scheduler: lifecycle,
      concurrency: { mode: "serial", key: targetKey },
    }),
    write: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:worktree-runs:write",
      tag: WS_METHODS.worktreeRunWrite,
    }),
    resize: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:worktree-runs:resize",
      tag: WS_METHODS.worktreeRunResize,
    }),
    clear: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:worktree-runs:clear",
      tag: WS_METHODS.worktreeRunClear,
      scheduler: lifecycle,
      concurrency: { mode: "serial", key: targetKey },
    }),
    stop: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:worktree-runs:stop",
      tag: WS_METHODS.worktreeRunStop,
      scheduler: lifecycle,
      concurrency: { mode: "serial", key: targetKey },
    }),
  };
}
