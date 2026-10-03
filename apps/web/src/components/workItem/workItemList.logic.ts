/**
 * Selection and keyboard rules the work item lists share. Pure, so the pull request and issue
 * pages answer the same keys the same way and the rules are tested without a DOM.
 */

/**
 * A shift-click: every row from the anchor to the target, in list order, joins the selection.
 * Without an anchor still on screen it behaves like a plain toggle of the target, which is what
 * the reader sees happen to the one row they clicked.
 */
export function selectWorkItemRange(
  orderedKeys: ReadonlyArray<string>,
  anchorKey: string | null,
  targetKey: string,
  selected: ReadonlySet<string>,
): ReadonlySet<string> {
  const targetIndex = orderedKeys.indexOf(targetKey);
  const anchorIndex = anchorKey === null ? -1 : orderedKeys.indexOf(anchorKey);
  if (targetIndex === -1) return selected;
  if (anchorIndex === -1) return toggleWorkItemSelection(selected, targetKey);
  const [start, end] =
    anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
  const next = new Set(selected);
  for (const key of orderedKeys.slice(start, end + 1)) next.add(key);
  return next;
}

export function toggleWorkItemSelection(
  selected: ReadonlySet<string>,
  key: string,
): ReadonlySet<string> {
  const next = new Set(selected);
  if (!next.delete(key)) next.add(key);
  return next;
}

/** Drops keys whose rows have left the list, so a hidden row cannot ride along into an action. */
export function retainVisibleWorkItemSelection(
  selected: ReadonlySet<string>,
  orderedKeys: ReadonlyArray<string>,
): ReadonlySet<string> {
  if (selected.size === 0) return selected;
  const visible = new Set(orderedKeys);
  const next = new Set([...selected].filter((key) => visible.has(key)));
  return next.size === selected.size ? selected : next;
}

/**
 * Where j/k land. With no cursor yet the first press starts at the top going down and at the
 * bottom going up; the ends hold rather than wrap, so holding a key cannot lose the reader.
 */
export function nextWorkItemCursor(
  orderedKeys: ReadonlyArray<string>,
  current: string | null,
  direction: 1 | -1,
): string | null {
  if (orderedKeys.length === 0) return null;
  const index = current === null ? -1 : orderedKeys.indexOf(current);
  if (index === -1) return direction === 1 ? orderedKeys[0]! : orderedKeys.at(-1)!;
  return orderedKeys[Math.min(orderedKeys.length - 1, Math.max(0, index + direction))]!;
}

export type WorkItemListCommand = "next" | "previous" | "toggle" | "create" | "select-all";

/**
 * Which list command a key press names, or null when it is not one. Typing anywhere, an open
 * menu or dialog, and any modifier but Mod+A leave the key to whoever has it. Arrows only move
 * the cursor once focus is already in the list, since elsewhere they scroll or move a caret.
 */
export function workItemListCommand(event: {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  /** Focus is in a field, a menu or a dialog, where the keys mean something else. */
  readonly typing: boolean;
  readonly listFocused: boolean;
}): WorkItemListCommand | null {
  if (event.typing || event.altKey) return null;
  const mod = event.metaKey || event.ctrlKey;
  if (mod) {
    return event.listFocused && !event.shiftKey && event.key.toLowerCase() === "a"
      ? "select-all"
      : null;
  }
  if (event.shiftKey) return null;
  switch (event.key) {
    case "j":
      return "next";
    case "k":
      return "previous";
    case "ArrowDown":
      return event.listFocused ? "next" : null;
    case "ArrowUp":
      return event.listFocused ? "previous" : null;
    case "x":
      return "toggle";
    case "c":
      return "create";
    default:
      return null;
  }
}
