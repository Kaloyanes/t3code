import { useEffect, useEffectEvent, useRef, type RefObject } from "react";

import { isCommandPaletteOpen } from "~/commandPaletteBus";

import { nextWorkItemCursor, workItemListCommand } from "./workItemList.logic";

/** Marks a row's focusable control; the value is the row's key. */
export const WORK_ITEM_ROW_ATTRIBUTE = "data-work-item-row";

function rowKeyOf(element: Element | null): string | null {
  return (
    element?.closest(`[${WORK_ITEM_ROW_ATTRIBUTE}]`)?.getAttribute(WORK_ITEM_ROW_ATTRIBUTE) ?? null
  );
}

function isTypingTarget(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  return element.closest("input, textarea, select, [contenteditable='true']") !== null;
}

/**
 * j/k (and the arrows once the list has focus) walk a cursor through the rows, and the cursor is
 * the browser's own focus: Enter then activates the focused row the way any button does, and
 * focus-visible draws it. `x`, `c` and Mod+A are offered by pages that select and create.
 *
 * Keys are only taken while focus is on the page itself or inside `listRef` — not in the right
 * panel, a dialog, a menu or a field — and never with the command palette open. Registered on
 * the document so Escape can clear a selection before the page's go-back handler on window.
 */
export function useWorkItemListKeyboard({
  listRef,
  enabled = true,
  onToggle,
  onCreate,
  onSelectAll,
  onClearSelection,
}: {
  listRef: RefObject<HTMLElement | null>;
  enabled?: boolean;
  onToggle?: (key: string) => void;
  onCreate?: () => void;
  onSelectAll?: () => void;
  /** Returns whether it cleared anything; only then is Escape kept from going back. */
  onClearSelection?: () => boolean;
}) {
  // Where the cursor was when focus last left the list, so j picks up there rather than at the
  // top after the reader clicked away.
  const lastKeyRef = useRef<string | null>(null);
  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || isCommandPaletteOpen()) return;
    const list = listRef.current;
    if (list === null) return;
    const active = document.activeElement;
    const onPage = active === null || active === document.body || list.contains(active);
    if (!onPage) return;
    if (event.key === "Escape") {
      if (onClearSelection?.()) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    const focusedKey = rowKeyOf(active);
    const command = workItemListCommand({
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      typing: isTypingTarget(active),
      listFocused: focusedKey !== null,
    });
    if (command === null) return;
    if (command === "create") {
      if (!onCreate) return;
      event.preventDefault();
      onCreate();
      return;
    }
    if (command === "select-all") {
      if (!onSelectAll) return;
      event.preventDefault();
      onSelectAll();
      return;
    }
    if (command === "toggle") {
      if (!onToggle || focusedKey === null) return;
      event.preventDefault();
      onToggle(focusedKey);
      return;
    }
    const rows = [...list.querySelectorAll<HTMLElement>(`[${WORK_ITEM_ROW_ATTRIBUTE}]`)];
    const keys = rows.map((row) => row.getAttribute(WORK_ITEM_ROW_ATTRIBUTE) ?? "");
    const selectedRowKey = rowKeyOf(
      list.querySelector(`[${WORK_ITEM_ROW_ATTRIBUTE}][aria-current="true"]`),
    );
    const from =
      focusedKey ??
      (lastKeyRef.current !== null && keys.includes(lastKeyRef.current)
        ? lastKeyRef.current
        : selectedRowKey);
    const next = nextWorkItemCursor(keys, from, command === "next" ? 1 : -1);
    const row = next === null ? undefined : rows[keys.indexOf(next)];
    if (row === undefined) return;
    event.preventDefault();
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: "nearest" });
  });
  const handleFocusIn = useEffectEvent((event: FocusEvent) => {
    const key = rowKeyOf(event.target instanceof Element ? event.target : null);
    if (key !== null) lastKeyRef.current = key;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => handleKeyDown(event);
    const onFocusIn = (event: FocusEvent) => handleFocusIn(event);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [enabled]);
}
