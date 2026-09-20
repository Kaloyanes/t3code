import { describe, expect, it } from "vite-plus/test";
import { AutomationSchedule } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { nextAutomationRun } from "./schedule.ts";

const decodeSchedule = (value: unknown) => Schema.decodeUnknownSync(AutomationSchedule)(value);

describe("nextAutomationRun", () => {
  it("finds the next one-time wall-clock occurrence", () => {
    const schedule = decodeSchedule({
      kind: "once",
      date: "2026-09-20",
      time: "09:30",
      timeZone: "Europe/Sofia",
    });

    expect(nextAutomationRun(schedule, Date.parse("2026-09-20T05:00:00.000Z"))).toBe(
      "2026-09-20T06:30:00.000Z",
    );
    expect(nextAutomationRun(schedule, Date.parse("2026-09-20T06:30:00.000Z"))).toBeNull();
  });

  it("finds the next daily and weekly occurrence after now", () => {
    const daily = decodeSchedule({ kind: "daily", time: "09:30", timeZone: "UTC" });
    const weekly = decodeSchedule({
      kind: "weekly",
      days: ["monday", "friday"],
      time: "09:30",
      timeZone: "UTC",
    });

    expect(nextAutomationRun(daily, Date.parse("2026-09-20T08:00:00.000Z"))).toBe(
      "2026-09-20T09:30:00.000Z",
    );
    expect(nextAutomationRun(daily, Date.parse("2026-09-20T10:00:00.000Z"))).toBe(
      "2026-09-21T09:30:00.000Z",
    );
    expect(nextAutomationRun(weekly, Date.parse("2026-09-22T10:00:00.000Z"))).toBe(
      "2026-09-25T09:30:00.000Z",
    );
  });

  it("moves a nonexistent spring-forward time to the next valid minute", () => {
    const schedule = decodeSchedule({
      kind: "once",
      date: "2026-03-08",
      time: "02:30",
      timeZone: "America/New_York",
    });

    expect(nextAutomationRun(schedule, Date.parse("2026-03-07T00:00:00.000Z"))).toBe(
      "2026-03-08T07:00:00.000Z",
    );
  });

  it("rejects an invalid timezone instead of silently scheduling in UTC", () => {
    const schedule = decodeSchedule({ kind: "daily", time: "09:30", timeZone: "Mars/Base" });

    expect(() => nextAutomationRun(schedule, Date.parse("2026-09-20T08:00:00.000Z"))).toThrow(
      "Invalid automation timezone",
    );
  });
});
