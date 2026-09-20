import { describe, expect, it } from "vite-plus/test";

import {
  joinAutomationTime,
  selectedOptionLabel,
  splitAutomationTime,
  supportedTimeZones,
} from "./automationEditor.logic";

describe("automation editor time controls", () => {
  it("round-trips the stored 24-hour time", () => {
    expect(splitAutomationTime("09:05")).toEqual({ hour: "09", minute: "05" });
    expect(joinAutomationTime("23", "45")).toBe("23:45");
  });

  it("shows an option's user-facing label instead of its stored value", () => {
    expect(
      selectedOptionLabel(
        [{ value: "546877db-e823-4422-9fd0-3a34534dcf16", label: "T3 Code" }],
        "546877db-e823-4422-9fd0-3a34534dcf16",
        "Select project",
      ),
    ).toBe("T3 Code");
  });

  it("keeps the current zone and UTC available when the runtime list is unavailable", () => {
    expect(supportedTimeZones(undefined, "Europe/Sofia")).toEqual(["Europe/Sofia", "UTC"]);
  });

  it("deduplicates and sorts supported zones", () => {
    expect(supportedTimeZones(["UTC", "America/New_York", "UTC"], "Europe/Sofia")).toEqual([
      "America/New_York",
      "Europe/Sofia",
      "UTC",
    ]);
  });
});
