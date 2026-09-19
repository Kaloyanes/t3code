import type { EnvironmentId, WorktreeRunTarget } from "@t3tools/contracts";
import { create } from "zustand";

export interface WorktreeRunTerminalTarget {
  readonly environmentId: EnvironmentId;
  readonly target: WorktreeRunTarget;
}

interface WorktreeRunTerminalState {
  readonly active: WorktreeRunTerminalTarget | null;
  open: (active: WorktreeRunTerminalTarget) => void;
  select: (scriptId: string) => void;
  close: () => void;
}

export const useWorktreeRunTerminalStore = create<WorktreeRunTerminalState>((set) => ({
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
