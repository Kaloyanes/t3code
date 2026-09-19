import type { EnvironmentId, WorktreeRunTarget } from "@t3tools/contracts";
import { create } from "zustand";

export interface WorktreeRunConsoleTarget {
  readonly environmentId: EnvironmentId;
  readonly target: WorktreeRunTarget;
}

interface WorktreeRunConsoleState {
  readonly active: WorktreeRunConsoleTarget | null;
  open: (active: WorktreeRunConsoleTarget) => void;
  select: (scriptId: string) => void;
  close: () => void;
}

export const useWorktreeRunConsoleStore = create<WorktreeRunConsoleState>((set) => ({
  active: null,
  open: (active) => set({ active }),
  select: (scriptId) =>
    set((state) =>
      state.active === null
        ? state
        : { active: { ...state.active, target: { ...state.active.target, scriptId } } },
    ),
  close: () => set({ active: null }),
}));
