export function splitAutomationTime(time: string): { hour: string; minute: string } {
  const [hour = "09", minute = "00"] = time.split(":");
  return { hour, minute };
}

export function joinAutomationTime(hour: string, minute: string): string {
  return `${hour}:${minute}`;
}

export function selectedOptionLabel<T extends string>(
  options: ReadonlyArray<{ readonly value: T; readonly label: string }>,
  value: T,
  fallback: string,
): string {
  return options.find((option) => option.value === value)?.label ?? fallback;
}

export function supportedTimeZones(
  zones: ReadonlyArray<string> | undefined,
  currentZone: string,
): ReadonlyArray<string> {
  return [...new Set([...(zones ?? []), currentZone, "UTC"])].sort((left, right) =>
    left.localeCompare(right),
  );
}
