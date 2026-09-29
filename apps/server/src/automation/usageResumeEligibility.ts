import * as DateTime from "effect/DateTime";
import type {
  OrchestrationThreadShell,
  ServerProvider,
  UsageResumeEligibility,
} from "@t3tools/contracts";

export const USAGE_RESUME_PROMPT =
  "Continue from where you stopped. Check what is already done before proceeding.";

export function usageResumeEligibility(
  thread: OrchestrationThreadShell | undefined,
  provider: ServerProvider | undefined,
  now: number,
): UsageResumeEligibility {
  const unavailable = (reason: string | null): UsageResumeEligibility => ({
    available: false,
    resetsAt: null,
    reason,
    defaultPrompt: null,
  });
  if (
    thread?.session?.lastError?.startsWith("Claude usage limit reached.") ||
    thread?.session?.lastError === "Claude stopped: a usage limit blocked the request."
  )
    return unavailable("Scheduled usage reset resumes are not yet supported for Claude.");
  // This prefix is produced only for Codex's typed usageLimitExceeded error.
  if (!thread?.session?.lastError?.startsWith("Codex usage limit reached."))
    return unavailable(null);
  if (thread.archivedAt) return unavailable("This thread is archived.");
  if (provider?.driver !== "codex" || !provider.enabled || !provider.installed)
    return unavailable("This provider cannot schedule a usage reset resume.");
  if (thread.modelSelection.model.toLowerCase().includes("spark"))
    return unavailable("The provider does not report a reliable reset for this model.");
  const limits = provider.usageLimits;
  if (!limits || limits.unavailable)
    return unavailable(
      "A fresh usage reset time is unavailable. Refresh provider usage and try again.",
    );
  const blocked = limits.windows.filter((window) => window.usedPercent >= 100);
  if (
    !blocked.length ||
    blocked.some((window) => !window.resetsAt || Date.parse(window.resetsAt) <= now)
  )
    return unavailable("The provider has not reported a future reset for every exhausted window.");
  return {
    available: true,
    resetsAt: DateTime.formatIso(
      DateTime.makeUnsafe(Math.max(...blocked.map((window) => Date.parse(window.resetsAt!)))),
    ),
    reason: null,
    defaultPrompt: USAGE_RESUME_PROMPT,
  };
}
