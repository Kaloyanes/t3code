import * as Schema from "effect/Schema";

import { useLocalStorage } from "./hooks/useLocalStorage";

export const SIDEBAR_LAYOUT_MODES = ["flat", "grouped"] as const;
export type SidebarLayout = (typeof SIDEBAR_LAYOUT_MODES)[number];

export const DEFAULT_SIDEBAR_LAYOUT: SidebarLayout = "flat";
export const SIDEBAR_LAYOUT_STORAGE_KEY = "t3code:sidebar-layout";

const SidebarLayoutSchema = Schema.Literals(SIDEBAR_LAYOUT_MODES);

export type SidebarLayoutPreferenceSetter = (
  value: SidebarLayout | ((current: SidebarLayout) => SidebarLayout),
) => void;

export function useSidebarLayoutPreference(): readonly [
  SidebarLayout,
  SidebarLayoutPreferenceSetter,
] {
  const [layout, setLayout] = useLocalStorage(
    SIDEBAR_LAYOUT_STORAGE_KEY,
    DEFAULT_SIDEBAR_LAYOUT,
    SidebarLayoutSchema,
  );

  return [layout, setLayout];
}
