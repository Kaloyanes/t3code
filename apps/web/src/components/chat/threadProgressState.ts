import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { create } from "zustand";

import {
  getClientSettings,
  updateClientSettings,
  useClientSettings,
} from "../../hooks/useSettings";
import { selectThreadPanelOpen, useRightPanelStore } from "../../rightPanelStore";
import { useChatCanvas } from "./ChatCanvasContext";
import {
  resolveThreadDetailsVisibility,
  setThreadDetailsItem,
  THREAD_DETAILS_ITEMS,
} from "./threadDetailsItems";

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
  const shownInDetails = useClientSettings(
    (settings) => resolveThreadDetailsVisibility(settings).taskProgress,
  );
  return detailsOpen && shownInDetails && !closed;
}

export function showThreadProgressInDetails(threadRef: ScopedThreadRef, inline: boolean) {
  const settings = getClientSettings();
  if (!resolveThreadDetailsVisibility(settings).taskProgress) {
    const item = THREAD_DETAILS_ITEMS.find((candidate) => candidate.id === "taskProgress");
    if (item)
      updateClientSettings({ threadDetailsItems: setThreadDetailsItem(settings, item, true) });
  }
  useThreadProgressStore.getState().setClosed(threadRef, false);
  useRightPanelStore.getState().setThreadPanelOpen(threadRef, inline ? "inline" : "popover", true);
}
