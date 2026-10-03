import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  IssueInvolvement,
  IssueListSort,
  IssueListState,
  ProjectId,
} from "@t3tools/contracts";

/**
 * The list controls the issues page remembers, the same way the pull request page does. The
 * selected issue stays a URL and right-panel concern. `scope: "all"` and a `projectId` are the
 * two answers to "which projects": without either, every project is listed.
 */
export interface IssueListPreferences {
  readonly state: IssueListState;
  readonly involvement?: IssueInvolvement;
  readonly sort?: IssueListSort;
  readonly labels?: ReadonlyArray<string>;
  readonly author?: string;
  readonly assignee?: string;
  readonly milestone?: string;
  readonly scope?: "all";
  readonly projectId?: ProjectId;
  readonly environmentId?: EnvironmentId;
}

const BoundedPreference = Schema.String.check(Schema.isMaxLength(200));
const IssueListPreferencesSchema = Schema.Struct({
  state: IssueListState,
  involvement: Schema.optional(IssueInvolvement),
  sort: Schema.optional(IssueListSort),
  labels: Schema.optional(Schema.Array(BoundedPreference).check(Schema.isMaxLength(25))),
  author: Schema.optional(BoundedPreference),
  assignee: Schema.optional(BoundedPreference),
  milestone: Schema.optional(BoundedPreference),
  scope: Schema.optional(Schema.Literal("all")),
  projectId: Schema.optional(ProjectId),
  environmentId: Schema.optional(EnvironmentId),
});
const decodeIssueListPreferences = Schema.decodeUnknownOption(IssueListPreferencesSchema);

const ISSUE_LIST_PREFERENCES_STORAGE_KEY = "t3code:issue-list-preferences:v1";
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

function resolveStorage(storage: PreferenceStorage | undefined): PreferenceStorage | undefined {
  return storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
}

/** Any search-shaped record, where a cleared field may still be present as `undefined`. */
export type IssueListPreferencesInput = {
  readonly [Key in keyof IssueListPreferences]?: IssueListPreferences[Key] | undefined;
} & { readonly state: IssueListState };

/** Only the remembered fields, with defaults left out so the URL stays short. */
export function issueListPreferences(search: IssueListPreferencesInput): IssueListPreferences {
  return {
    state: search.state,
    ...(search.involvement && search.involvement !== "all"
      ? { involvement: search.involvement }
      : {}),
    ...(search.sort && search.sort !== "updated" ? { sort: search.sort } : {}),
    ...(search.labels && search.labels.length > 0 ? { labels: search.labels } : {}),
    ...(search.author ? { author: search.author } : {}),
    ...(search.assignee ? { assignee: search.assignee } : {}),
    ...(search.milestone ? { milestone: search.milestone } : {}),
    ...(search.projectId
      ? {
          projectId: search.projectId,
          ...(search.environmentId ? { environmentId: search.environmentId } : {}),
        }
      : search.scope === "all"
        ? { scope: "all" as const }
        : {}),
  };
}

// The page reads these on every navigation it validates, so one parse serves until they change.
let cached: { readonly raw: string; readonly value: IssueListPreferences | null } | null = null;

export function readIssueListPreferences(storage?: PreferenceStorage): IssueListPreferences | null {
  try {
    const raw = resolveStorage(storage)?.getItem(ISSUE_LIST_PREFERENCES_STORAGE_KEY);
    if (!raw) return null;
    if (cached?.raw === raw) return cached.value;
    const decoded = decodeIssueListPreferences(JSON.parse(raw));
    const value = decoded._tag === "Some" ? issueListPreferences(decoded.value) : null;
    cached = { raw, value };
    return value;
  } catch {
    return null;
  }
}

export function writeIssueListPreferences(
  preferences: IssueListPreferencesInput,
  storage?: PreferenceStorage,
): void {
  try {
    resolveStorage(storage)?.setItem(
      ISSUE_LIST_PREFERENCES_STORAGE_KEY,
      JSON.stringify(issueListPreferences(preferences)),
    );
  } catch {
    // Storage can be full or denied; the URL remains the source of truth for this visit.
  }
}

const LIST_KEYS = ["involvement", "sort", "labels", "author", "assignee", "milestone"] as const;

/**
 * What a link left unsaid, filled from the remembered list: the sidebar and command palette
 * open the page with only a state and perhaps the active thread's project, and the reader's
 * own filters, sort and project choice should still be there. Each part is filled only when the
 * link names none of it, so an explicit link always wins.
 */
export function rememberedIssueListFields(
  raw: Record<string, unknown>,
  remembered: IssueListPreferences | null,
): Partial<IssueListPreferences> {
  if (remembered === null) return {};
  const listUnsaid = LIST_KEYS.every((key) => raw[key] === undefined);
  const scopeUnsaid = raw.projectId === undefined && raw.scope === undefined;
  return {
    ...(raw.state === undefined ? { state: remembered.state } : {}),
    ...(listUnsaid
      ? Object.fromEntries(
          LIST_KEYS.flatMap((key) => (remembered[key] ? [[key, remembered[key]]] : [])),
        )
      : {}),
    ...(scopeUnsaid
      ? remembered.projectId
        ? {
            projectId: remembered.projectId,
            ...(remembered.environmentId ? { environmentId: remembered.environmentId } : {}),
          }
        : remembered.scope
          ? { scope: remembered.scope }
          : {}
      : {}),
  };
}
