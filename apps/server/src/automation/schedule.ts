// @effect-diagnostics globalDate:off -- Intl is the only practical way to resolve IANA wall-clock schedules.
import type { AutomationSchedule } from "@t3tools/contracts";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

interface LocalParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

function makeFormatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new Error(`Invalid automation timezone: ${timeZone}`);
  }
}

function formatLocal(formatter: Intl.DateTimeFormat, timestampMs: number): LocalParts {
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(timestampMs)).map(({ type, value }) => [type, value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function toLocalDateMs(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const timestampMs = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestampMs);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Invalid automation date: ${date}`);
  }
  return timestampMs;
}

function toWallClockMs(date: string, time: string): number {
  const dateMs = toLocalDateMs(date);
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(3, 5));
  return dateMs + (hour * 60 + minute) * MINUTE_MS;
}

function toDateString(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

function resolveExactWallClock(formatter: Intl.DateTimeFormat, wallClockMs: number): number | null {
  const offsets = new Set<number>();
  for (let offsetMs = -2 * DAY_MS; offsetMs <= 2 * DAY_MS; offsetMs += 6 * 60 * MINUTE_MS) {
    const probeMs = wallClockMs + offsetMs;
    const local = formatLocal(formatter, probeMs);
    const localMs = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
    offsets.add(probeMs - localMs);
  }

  const candidates = [...offsets]
    .map((offsetMs) => wallClockMs + offsetMs)
    .filter((candidateMs) => {
      const local = formatLocal(formatter, candidateMs);
      return (
        Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) === wallClockMs
      );
    });

  return candidates.length === 0 ? null : Math.min(...candidates);
}

function resolveWallClock(formatter: Intl.DateTimeFormat, date: string, time: string): number {
  const wallClockMs = toWallClockMs(date, time);
  const exact = resolveExactWallClock(formatter, wallClockMs);
  if (exact !== null) return exact;

  for (let minute = 1; minute <= 180; minute += 1) {
    const next = resolveExactWallClock(formatter, wallClockMs + minute * MINUTE_MS);
    if (next !== null) return next;
  }
  throw new Error(`Unable to resolve automation wall-clock time: ${date} ${time}`);
}

function nextDaily(
  schedule: Extract<AutomationSchedule, { kind: "daily" }>,
  nowMs: number,
  formatter: Intl.DateTimeFormat,
): number {
  const current = formatLocal(formatter, nowMs);
  const currentDate = `${current.year.toString().padStart(4, "0")}-${current.month
    .toString()
    .padStart(2, "0")}-${current.day.toString().padStart(2, "0")}`;
  const today = resolveWallClock(formatter, currentDate, schedule.time);
  return today > nowMs
    ? today
    : resolveWallClock(formatter, toDateString(toLocalDateMs(currentDate) + DAY_MS), schedule.time);
}

function nextWeekly(
  schedule: Extract<AutomationSchedule, { kind: "weekly" }>,
  nowMs: number,
  formatter: Intl.DateTimeFormat,
): number {
  const current = formatLocal(formatter, nowMs);
  const currentDateMs = toLocalDateMs(
    `${current.year.toString().padStart(4, "0")}-${current.month.toString().padStart(2, "0")}-${current.day
      .toString()
      .padStart(2, "0")}`,
  );
  const days = new Set(schedule.days);

  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const dateMs = currentDateMs + dayOffset * DAY_MS;
    const date = toDateString(dateMs);
    const weekday = WEEKDAYS[new Date(dateMs).getUTCDay()];
    if (weekday === undefined || !days.has(weekday)) continue;
    const candidate = resolveWallClock(formatter, date, schedule.time);
    if (candidate > nowMs) return candidate;
  }
  throw new Error("Unable to find the next automation weekday");
}

export function nextAutomationRun(schedule: AutomationSchedule, nowMs: number): string | null {
  const formatter = makeFormatter(schedule.timeZone);
  const candidate =
    schedule.kind === "once"
      ? resolveWallClock(formatter, schedule.date, schedule.time)
      : schedule.kind === "daily"
        ? nextDaily(schedule, nowMs, formatter)
        : nextWeekly(schedule, nowMs, formatter);

  if (schedule.kind === "once" && candidate <= nowMs) return null;
  return new Date(candidate).toISOString();
}
