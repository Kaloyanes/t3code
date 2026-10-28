import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { create } from "zustand";

import { selectThreadPanelOpen, useRightPanelStore } from "../../rightPanelStore";
import { useChatCanvas } from "./ChatCanvasContext";

interface ThreadProgressStore {
  readonly closedByThreadKey: Readonly<Record<string, true>>;
  readonly setClosed: (threadRef: ScopedThreadRef, closed: boolean) => void;
}

export const useThreadProgressStore = create<ThreadProgressStore>()((set) => ({
  closedByThreadKey: {},
  setClosed: (threadRef, closed) =>
    set((state) => {
      const key = scopedThreadKey(threadRef);
      if ((state.closedByThreadKey[key] === true) === closed) return state;
      const { [key]: _removed, ...rest } = state.closedByThreadKey;
      return { closedByThreadKey: closed ? { ...rest, [key]: true } : rest };
    }),
}));

export function useThreadProgressCardVisible(threadRef: ScopedThreadRef): boolean {
  const inline = useChatCanvas()?.detailsCardPlacement != null;
  const detailsOpen = useRightPanelStore((state) =>
    selectThreadPanelOpen(
      state.threadPanelVisibilityByThreadKey,
      threadRef,
      inline ? "inline" : "popover",
    ),
  );
  const closed = useThreadProgressStore(
    (state) => state.closedByThreadKey[scopedThreadKey(threadRef)] === true,
  );
  return detailsOpen && !closed;
}

export function showThreadProgressInDetails(threadRef: ScopedThreadRef, inline: boolean) {
  useThreadProgressStore.getState().setClosed(threadRef, false);
  useRightPanelStore.getState().setThreadPanelOpen(threadRef, inline ? "inline" : "popover", true);
}
