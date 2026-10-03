import { type UIEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * A work item panel's header folds away once its body is scrolled past the fold, leaving one
 * condensed row, and opens again at the very top. Attach `foldRef` to the part that folds,
 * `condensedRowRef` to the row that replaces it, and `onScrollCapture` to the element that wraps
 * every tab's scroll box.
 *
 * Each tab remembers its own state: short tabs cannot scroll to reopen the chrome.
 */
export function useCondensingChrome<Tab extends string>(tab: Tab) {
  const [condensed, setCondensed] = useState(false);
  const chromeStateByTab = useRef<Partial<Record<Tab, boolean>>>({});
  useEffect(() => {
    setCondensed(chromeStateByTab.current[tab] ?? false);
  }, [tab]);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const foldRef = useRef<HTMLDivElement | null>(null);
  const condensedRowRef = useRef<HTMLDivElement | null>(null);
  // Refund after the fold commits so the content under the reader does not jump with its height.
  const compensationRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (compensationRef.current === null) return;
    const scroller = scrollerRef.current;
    const delta = compensationRef.current;
    compensationRef.current = null;
    if (scroller) scroller.scrollTop = Math.max(0, scroller.scrollTop + delta);
  }, [condensed]);

  const onScrollCapture = useCallback(
    (event: UIEvent<HTMLElement>) => {
      const scroller = event.target as HTMLElement;
      scrollerRef.current = scroller;
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
          compensationRef.current = -chromeDelta;
          next = true;
        }
        chromeStateByTab.current[tab] = next;
        return next;
      });
    },
    [tab],
  );

  return { condensed, foldRef, condensedRowRef, onScrollCapture };
}
