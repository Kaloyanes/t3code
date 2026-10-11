import { type UiAnimationDurationMs } from "@t3tools/contracts/settings";
import { useSyncExternalStore } from "react";

export const uiAnimationsActive = (
  durationMs: UiAnimationDurationMs,
  prefersReducedMotion: boolean,
) => durationMs > 0 && !prefersReducedMotion;

interface UiAnimationSettings {
  readonly active: boolean;
  readonly durationMs: UiAnimationDurationMs;
}

// The root publishes the resolved setting here. Animated primitives read this small
// store instead of the settings hooks, which pull in connection and session state:
// a low-level UI import must not create a module cycle back into app startup.
let current: UiAnimationSettings = { active: false, durationMs: 0 };
const listeners = new Set<() => void>();

export function publishUiAnimationSettings(next: UiAnimationSettings) {
  if (next.active === current.active && next.durationMs === current.durationMs) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => current;

export function useUiAnimationSettings(): UiAnimationSettings {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
