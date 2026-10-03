import type {
  IssueActor,
  IssueCandidateKind,
  IssueCandidatesInput,
  IssueLabel,
  IssueRelatedIssue,
  IssueRepositorySelection,
  IssueStateReason,
  IssueSubIssuesSummary,
  IssueTimelineEvent,
} from "@t3tools/contracts";

export interface IssueSubIssueProgress {
  readonly total: number;
  readonly completed: number;
  /** Whole percent, 0–100, for the bar's width. */
  readonly percent: number;
  readonly label: string;
}

/**
 * The host's own count where it sent one, since the list it sends may be a first page; counted
 * from the list otherwise. Null when there are no sub-issues to report on.
 */
export function issueSubIssueProgress(
  summary: IssueSubIssuesSummary | undefined,
  subIssues: ReadonlyArray<Pick<IssueRelatedIssue, "state">> | undefined,
): IssueSubIssueProgress | null {
  const listed = subIssues ?? [];
  const total = summary?.total ?? listed.length;
  if (total === 0) return null;
  const completed = Math.min(
    total,
    summary?.completed ?? listed.filter((issue) => issue.state === "closed").length,
  );
  return {
    total,
    completed,
    percent: Math.round((completed / total) * 100),
    label: `${completed} of ${total} done`,
  };
}

/** A label or login put on or taken off, matched the way GitHub matches them: by case. */
export function toggleIssueName(
  names: ReadonlyArray<string>,
  name: string,
  applied: boolean,
): ReadonlyArray<string> {
  const rest = names.filter((entry) => entry.toLowerCase() !== name.toLowerCase());
  return applied ? [...rest, name] : rest;
}

export function hasIssueName(names: ReadonlyArray<string>, name: string): boolean {
  return names.some((entry) => entry.toLowerCase() === name.toLowerCase());
}

/**
 * One candidates read per repository and kind, whoever asks: the summary's picker, the new-issue
 * dialog and its chips all key the same query, so the keys must match field for field.
 */
export function issueCandidatesInput(
  selection: IssueRepositorySelection,
  kind: IssueCandidateKind,
): IssueCandidatesInput {
  return {
    projectId: selection.projectId,
    ...(selection.host === undefined ? {} : { host: selection.host }),
    repository: selection.repository,
    kind,
    limit: 100,
  };
}

export type IssueTimelineRow =
  | {
      readonly kind: "labels";
      readonly id: string;
      readonly actor: IssueActor | null;
      readonly at: string;
      readonly added: ReadonlyArray<IssueLabel>;
      readonly removed: ReadonlyArray<IssueLabel>;
    }
  | {
      readonly kind: "assignees";
      readonly id: string;
      readonly actor: IssueActor | null;
      readonly at: string;
      readonly added: ReadonlyArray<IssueActor>;
      readonly removed: ReadonlyArray<IssueActor>;
    }
  | { readonly kind: "event"; readonly event: IssueTimelineEvent };

/** Edits further apart than this read as separate decisions, so they keep separate rows. */
const GROUP_WINDOW_MS = 5 * 60_000;

interface PendingChange<A> {
  readonly applied: boolean;
  readonly value: A;
}

/** Keyed by name or login, so a change made and undone within the run nets out. */
function recordChange<A>(
  changes: Map<string, PendingChange<A>>,
  key: string,
  change: PendingChange<A>,
): void {
  const previous = changes.get(key.toLowerCase());
  if (previous !== undefined && previous.applied !== change.applied) {
    changes.delete(key.toLowerCase());
  } else {
    changes.set(key.toLowerCase(), change);
  }
}

function splitChanges<A>(changes: Map<string, PendingChange<A>>) {
  const entries = [...changes.values()];
  return {
    added: entries.filter((entry) => entry.applied).map((entry) => entry.value),
    removed: entries.filter((entry) => !entry.applied).map((entry) => entry.value),
  };
}

/**
 * Collapses a run of label edits — or assignee edits — by one person into one row, the way
 * GitHub writes "added bug and removed triage". A change made and undone within the run nets
 * out, since neither half is still true.
 */
export function groupIssueTimelineEvents(
  events: ReadonlyArray<IssueTimelineEvent>,
): ReadonlyArray<IssueTimelineRow> {
  const rows: IssueTimelineRow[] = [];
  let open: {
    readonly kind: "labels" | "assignees";
    readonly id: string;
    readonly actor: IssueActor | null;
    readonly at: string;
    last: number;
    readonly labels: Map<string, PendingChange<IssueLabel>>;
    readonly assignees: Map<string, PendingChange<IssueActor>>;
  } | null = null;

  const flush = () => {
    if (open === null) return;
    const { id, actor, at } = open;
    const changes =
      open.kind === "labels"
        ? { kind: "labels" as const, ...splitChanges(open.labels) }
        : { kind: "assignees" as const, ...splitChanges(open.assignees) };
    if (changes.added.length > 0 || changes.removed.length > 0) {
      rows.push({ ...changes, id, actor, at });
    }
    open = null;
  };

  for (const event of events) {
    const kind =
      event._tag === "labeled" || event._tag === "unlabeled"
        ? "labels"
        : event._tag === "assigned" || event._tag === "unassigned"
          ? "assignees"
          : null;
    if (kind === null) {
      flush();
      rows.push({ kind: "event", event });
      continue;
    }
    const at = Date.parse(event.createdAt);
    if (
      open === null ||
      open.kind !== kind ||
      (open.actor?.login ?? null) !== (event.actor?.login ?? null) ||
      !(Math.abs(at - open.last) <= GROUP_WINDOW_MS)
    ) {
      flush();
      open = {
        kind,
        id: event.id,
        actor: event.actor,
        at: event.createdAt,
        last: at,
        labels: new Map(),
        assignees: new Map(),
      };
    }
    open.last = at;
    if (event._tag === "labeled" || event._tag === "unlabeled") {
      recordChange(open.labels, event.label.name, {
        applied: event._tag === "labeled",
        value: event.label,
      });
    } else if ((event._tag === "assigned" || event._tag === "unassigned") && event.assignee) {
      recordChange(open.assignees, event.assignee.login, {
        applied: event._tag === "assigned",
        value: event.assignee,
      });
    }
  }
  flush();
  return rows;
}

export function issueCloseReasonPhrase(reason: IssueStateReason): string {
  switch (reason) {
    case "completed":
      return "closed this as completed";
    case "not-planned":
      return "closed this as not planned";
    case "duplicate":
      return "closed this as a duplicate";
    default:
      return "closed this";
  }
}
