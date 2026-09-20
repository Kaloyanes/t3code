import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { usageMonitorRemainingPercent } from "./usageMonitor";

function usageWindow(
  input: Pick<ServerProviderUsageWindow, "id" | "kind" | "usedPercent" | "windowDurationMins">,
): ServerProviderUsageWindow {
  return {
    ...input,
    label: input.kind === "session" ? "Session" : "Weekly",
    resetsAt: "2026-09-24T12:00:00.000Z",
  };
}

describe("usageMonitorRemainingPercent", () => {
  const windows = [
    usageWindow({ id: "session", kind: "session", usedPercent: 0, windowDurationMins: 300 }),
    usageWindow({ id: "weekly", kind: "weekly", usedPercent: 45, windowDurationMins: 10080 }),
  ];

  it("keeps the lowest remaining percentage as the default", () => {
    expect(usageMonitorRemainingPercent(windows, "lowest-percentage")).toBe(55);
  });

  it("uses the shortest duration when selected", () => {
    expect(usageMonitorRemainingPercent(windows, "shortest-window")).toBe(100);
  });

  it("uses session before weekly when durations are unavailable", () => {
    const withoutDurations = windows.map(({ windowDurationMins: _, ...window }) => window);
    expect(usageMonitorRemainingPercent(withoutDurations, "shortest-window")).toBe(100);
  });

  it("returns undefined when no usage windows are available", () => {
    expect(usageMonitorRemainingPercent([], "shortest-window")).toBeUndefined();
  });
});
