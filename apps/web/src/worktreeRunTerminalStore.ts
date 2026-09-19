import type { EnvironmentId, WorktreeRunTarget } from "@t3tools/contracts";
import { create } from "zustand";

export interface WorktreeRunTerminalTarget {
  readonly environmentId: EnvironmentId;
  readonly target: WorktreeRunTarget;
}

interface WorktreeRunTerminalState {
  readonly active: WorktreeRunTerminalTarget | null;
  open: (active: WorktreeRunTerminalTarget) => void;
  close: () => void;
}

export const useWorktreeRunTerminalStore = create<WorktreeRunTerminalState>((set) => ({
  active: null,
  open: (active) => set({ active }),
  close: () => set({ active: null }),
}));
