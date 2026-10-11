import { type UIEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * A work item panel's header folds away once its body is scrolled past the fold, leaving one
 * condensed row, and opens again at the very top. Attach `foldRef` to the part that folds,
 * `condensedRowRef` to the row that replaces it, and `onScrollCapture` to the element that wraps
 * every tab's scroll box. Give each tab's scroll box `scrollerRef(tab)` so scrolls nested inside
 * it, or from a tab that is mounted but hidden, cannot fold the chrome.
 *
 * Each tab remembers its own state: short tabs cannot scroll to reopen the chrome.
 */
export function useCondensingChrome<Tab extends string>(tab: Tab) {
  const [condensed, setCondensed] = useState(false);
  const chromeStateByTab = useRef<Partial<Record<Tab, boolean>>>({});
  useEffect(() => {
    setCondensed(chromeStateByTab.current[tab] ?? false);
  }, [tab]);
  const scrollerByTab = useRef(new Map<Tab, HTMLElement | null>());
  const scrollerRefByTab = useRef(new Map<Tab, (node: HTMLElement | null) => void>());
  const scrollerRef = useCallback((forTab: Tab) => {
    let ref = scrollerRefByTab.current.get(forTab);
    if (!ref) {
      ref = (node) => {
        scrollerByTab.current.set(forTab, node);
      };
      scrollerRefByTab.current.set(forTab, ref);
    }
    return ref;
  }, []);
  const foldRef = useRef<HTMLDivElement | null>(null);
  const condensedRowRef = useRef<HTMLDivElement | null>(null);
  // Refund after the fold commits so the content under the reader does not jump with its height.
  const compensationRef = useRef<{ tab: Tab; scroller: HTMLElement; delta: number } | null>(null);
  useLayoutEffect(() => {
    const compensation = compensationRef.current;
    if (compensation === null) return;
    compensationRef.current = null;
    if (!condensed || compensation.tab !== tab) return;
    const registered = scrollerByTab.current.get(tab);
    if (registered !== undefined && registered !== compensation.scroller) return;
    compensation.scroller.scrollTop = Math.max(
      0,
      compensation.scroller.scrollTop + compensation.delta,
    );
  }, [condensed, tab]);

  const onScrollCapture = useCallback(
    (event: UIEvent<HTMLElement>) => {
      const registered = scrollerByTab.current.get(tab);
      if (registered !== undefined && event.target !== registered) return;
      const scroller = event.target as HTMLElement;
      const top = scroller.scrollTop;
      setCondensed((previous) => {
        let next = previous;
        const foldHeight = foldRef.current?.scrollHeight ?? 0;
        // The condensed row remains mounted, so refund only the height that actually leaves.
        const chromeDelta = foldHeight - (condensedRowRef.current?.scrollHeight ?? 0);
        if (previous) {
          // The hard top reopens the chrome with no refund: the reader asked for the top,
          // and moving them a fold's height back down would snatch it away — the fold
          // slides in above while the content stays where they left it.
          if (top < 4 && foldHeight > 0) {
            next = false;
          }
        } else if (foldHeight > 0 && top > foldHeight + 32) {
          compensationRef.current = { tab, scroller, delta: -chromeDelta };
          next = true;
        }
        chromeStateByTab.current[tab] = next;
        return next;
      });
    },
    [tab],
  );

  return { condensed, foldRef, condensedRowRef, scrollerRef, onScrollCapture };
}
