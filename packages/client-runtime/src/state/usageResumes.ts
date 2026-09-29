import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createUsageResumeEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    snapshot: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:usage-resumes:snapshot",
      tag: WS_METHODS.usageResumesSubscribe,
      idleTtlMs: 0,
    }),
    schedule: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:usage-resumes:schedule",
      tag: WS_METHODS.usageResumesSchedule,
    }),
    cancel: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:usage-resumes:cancel",
      tag: WS_METHODS.usageResumesCancel,
    }),
  };
}
