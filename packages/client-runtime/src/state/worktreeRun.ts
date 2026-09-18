import type {
  WorktreeRunAttachEvent,
  WorktreeRunMetadataEvent,
  WorktreeRunSnapshot,
  WorktreeRunSummary,
} from "@t3tools/contracts";
import { WS_METHODS } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { subscribe, type EnvironmentRpcInput } from "../rpc/client.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentSubscriptionAtomFamily,
} from "./runtime.ts";

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
  current: WorktreeRunSnapshot | null,
  event: WorktreeRunAttachEvent,
): WorktreeRunSnapshot | null {
  if (event.type === "snapshot") return event.snapshot;
  if (!current) return null;
  if (event.type === "output") return { ...current, history: current.history + event.data };
  if (event.type === "cleared") return { ...current, history: "" };
  if (event.type === "exited") {
    return {
      ...current,
      status: "exited",
      pid: null,
      exitCode: event.exitCode,
      exitSignal: event.exitSignal,
    };
  }
  return { ...current, status: "stopped", pid: null };
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
          Stream.scan([] as ReadonlyArray<WorktreeRunSummary>, applyWorktreeRunMetadataEvent),
        ),
    }),
    attach: createEnvironmentSubscriptionAtomFamily(runtime, {
      label: "environment-data:worktree-runs:attach",
      subscribe: (input: EnvironmentRpcInput<typeof WS_METHODS.worktreeRunAttach>) =>
        subscribe(WS_METHODS.worktreeRunAttach, input).pipe(
          Stream.scan(null as WorktreeRunSnapshot | null, applyWorktreeRunAttachEvent),
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
