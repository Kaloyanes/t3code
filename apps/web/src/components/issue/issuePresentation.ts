import type { IssueListEntry } from "@t3tools/contracts";
import { CircleCheckIcon, CircleDotIcon, CircleSlashIcon, type LucideIcon } from "lucide-react";

/**
 * Matches GitHub: open issues are green, completed ones purple like merged pull requests, and
 * ones closed without being done — not planned or a duplicate — recede. The sidebar's issue
 * chips and the issue list rows read from this one table.
 */
export const ISSUE_STATE_PRESENTATION = {
  open: {
    label: "Open",
    Icon: CircleDotIcon,
    toneClassName: "text-emerald-600 dark:text-emerald-400",
  },
  completed: {
    label: "Closed as completed",
    Icon: CircleCheckIcon,
    toneClassName: "text-violet-600 dark:text-violet-300/90",
  },
  "not-planned": {
    label: "Closed as not planned",
    Icon: CircleSlashIcon,
    toneClassName: "text-muted-foreground",
  },
  duplicate: {
    label: "Closed as duplicate",
    Icon: CircleSlashIcon,
    toneClassName: "text-muted-foreground",
  },
} as const satisfies Record<
  string,
  { readonly label: string; readonly Icon: LucideIcon; readonly toneClassName: string }
>;

export type IssuePresentationState = keyof typeof ISSUE_STATE_PRESENTATION;

/** A closed issue without a reason predates GitHub's reasons, which meant completed. */
export function issuePresentationState(
  entry: Pick<IssueListEntry, "state" | "stateReason">,
): IssuePresentationState {
  return entry.state === "open" ? "open" : (entry.stateReason ?? "completed");
}

/** The sidebar's linked-issue chips: the same tones, darkening on hover like a link. */
export const ISSUE_CHIP_TONE = {
  open: "text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300",
  closed:
    "text-violet-600 hover:text-violet-700 dark:text-violet-300/90 dark:hover:text-violet-200",
} as const;
