import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export function createAutomationEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const snapshot = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:automations:snapshot",
    tag: WS_METHODS.automationsGetSnapshot,
    staleTimeMs: 5_000,
    refreshIntervalMs: 30_000,
    idleTtlMs: 5 * 60_000,
  });

  return {
    snapshot,
    create: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:automations:create",
      tag: WS_METHODS.automationsCreate,
    }),
    update: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:automations:update",
      tag: WS_METHODS.automationsUpdate,
    }),
    pause: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:automations:pause",
      tag: WS_METHODS.automationsPause,
    }),
    resume: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:automations:resume",
      tag: WS_METHODS.automationsResume,
    }),
    cancel: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:automations:cancel",
      tag: WS_METHODS.automationsCancel,
    }),
    runNow: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:automations:run-now",
      tag: WS_METHODS.automationsRunNow,
    }),
    retryRun: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:automations:retry-run",
      tag: WS_METHODS.automationsRetryRun,
    }),
    stopRun: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:automations:stop-run",
      tag: WS_METHODS.automationsStopRun,
    }),
  };
}
