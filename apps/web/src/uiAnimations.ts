import { type UiAnimationDurationMs } from "@t3tools/contracts/settings";

import { useMediaQuery } from "./hooks/useMediaQuery";
import { useClientSettings } from "./hooks/useSettings";

export const uiAnimationsActive = (
  durationMs: UiAnimationDurationMs,
  prefersReducedMotion: boolean,
) => durationMs > 0 && !prefersReducedMotion;

export function useUiAnimationSettings(): {
  active: boolean;
  durationMs: UiAnimationDurationMs;
} {
  const durationMs = useClientSettings((settings) => settings.uiAnimationDurationMs);
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  return { active: uiAnimationsActive(durationMs, prefersReducedMotion), durationMs };
}
