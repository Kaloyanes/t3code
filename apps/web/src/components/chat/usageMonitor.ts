import type { ServerProviderUsageWindow, UsageMonitorMode } from "@t3tools/contracts";

import { remainingPercent } from "@t3tools/shared/usageLimits";

const WINDOW_KIND_ORDER: Record<ServerProviderUsageWindow["kind"], number> = {
  session: 0,
  weekly: 1,
  monthly: 2,
  other: 3,
};

function compareWindowDuration(
  left: ServerProviderUsageWindow,
  right: ServerProviderUsageWindow,
): number {
  if (left.windowDurationMins !== undefined && right.windowDurationMins !== undefined) {
    return left.windowDurationMins - right.windowDurationMins;
  }
  if (left.windowDurationMins !== undefined) return -1;
  if (right.windowDurationMins !== undefined) return 1;
  return WINDOW_KIND_ORDER[left.kind] - WINDOW_KIND_ORDER[right.kind];
}

/** Picks the value shown by the compact usage monitor in the chat header. */
export function usageMonitorRemainingPercent(
  windows: readonly ServerProviderUsageWindow[],
  mode: UsageMonitorMode,
): number | undefined {
  const selected =
    mode === "shortest-window"
      ? windows.toSorted(compareWindowDuration)[0]
      : windows.toSorted((left, right) => remainingPercent(left) - remainingPercent(right))[0];
  return selected === undefined ? undefined : remainingPercent(selected);
}
