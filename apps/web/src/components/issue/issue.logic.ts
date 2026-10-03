import type {
  EnvironmentId,
  IssueActor,
  IssueCloseInput,
  IssueInvolvement,
  IssueLabel,
  IssueListEntry,
  IssueListFilters,
  IssueListResult,
  IssueListSort,
  IssueLinkedWork,
  IssueRef,
  IssueReopenInput,
  IssueRepositorySelection,
  IssueUpdateInput,
  IssueWorktreeDeletePreflightItem,
  ProjectId,
} from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";

import {
  boundedWorkItemQualifier,
  MAX_WORK_ITEM_QUALIFIER_VALUES,
  parseWorkItemQualifier,
  WORK_ITEM_QUERY_TOKEN,
  workItemQueryLabelNames,
} from "../pullRequest/pullRequestList.logic";
export interface IssueRepositoryDescriptor {
  readonly projectId: ProjectId;
  readonly host: string;
  readonly repository: string;
}

export function normalizeIssueHost(host: string): string {
  const value = host.trim().toLowerCase();
  return value.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function hostFromRemote(remoteUrl: string | undefined): string {
  if (!remoteUrl) return "github.com";
  try {
    const parsed = new URL(remoteUrl);
    if (parsed.hostname.length > 0) return parsed.hostname.toLowerCase();
  } catch {
    const scp = /^git@([^:]+):/.exec(remoteUrl);
    if (scp?.[1]) return scp[1].toLowerCase();
  }
  return "github.com";
}

function repositoryNameFromIdentity(project: EnvironmentProject): string | null {
  const identity = project.repositoryIdentity;
  if (!identity) return null;
  const displayName = identity.displayName?.trim();
  if (displayName && displayName.includes("/")) return displayName;
  if (identity.owner?.trim() && identity.name?.trim()) {
    return `${identity.owner.trim()}/${identity.name.trim()}`;
  }
  const segments = identity.canonicalKey
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return segments.length >= 2 ? segments.slice(-2).join("/") : null;
}

export function issueRepositoryForProject(
  project: EnvironmentProject,
): IssueRepositoryDescriptor | null {
  const identity = project.repositoryIdentity;
  if (!identity) return null;
  const host = hostFromRemote(identity.locator.remoteUrl);
  const provider = identity.provider?.toLowerCase();
  if (provider !== undefined && provider !== "github") return null;
  if (provider === undefined && !host.includes("github")) return null;
  const repository = repositoryNameFromIdentity(project);
  return repository === null
    ? null
    : {
        projectId: project.id,
        host,
        repository,
      };
}

export function issueRepositorySelectionForProject(
  project: EnvironmentProject | null,
  host?: string,
): IssueRepositorySelection | null {
  if (project === null) return null;
  const descriptor = issueRepositoryForProject(project);
  if (descriptor === null) return null;
  const normalizedHost = host === undefined ? descriptor.host : normalizeIssueHost(host);
  return {
    projectId: descriptor.projectId,
    ...(normalizedHost.length > 0 ? { host: normalizedHost } : {}),
    repository: descriptor.repository,
  };
}

export function issueRepositoryUrl(
  selection: Pick<IssueRepositorySelection, "host" | "repository">,
): string {
  const host = normalizeIssueHost(selection.host ?? "github.com");
  return `https://${host}/${selection.repository}`;
}

export function issueEntryKey(
  entry: Pick<IssueListEntry, "host" | "repository" | "number">,
): string {
  return `${normalizeIssueHost(entry.host)}:${entry.repository.toLowerCase()}:${entry.number}`;
}

/** A list row plus the server it was read from; a project id only names a project there. */
export type EnvironmentIssueEntry = IssueListEntry & { readonly environmentId: EnvironmentId };

/** Unique across servers: two machines can hold the same repository and list the same issue. */
export function issueListEntryKey(entry: EnvironmentIssueEntry): string {
  return `${entry.environmentId}:${issueEntryKey(entry)}`;
}

export function issueRefForEntry(entry: IssueListEntry): IssueRef {
  return {
    projectId: entry.projectId,
    host: entry.host,
    repository: entry.repository,
    number: entry.number,
  };
}

/**
 * The full linked-work record the worktree dialog takes, rebuilt from the compact summary a list
 * row carries. Only the thread and checkout matter to the dialog; the link time is not on the
 * row, so the row's own update time stands in.
 */
export function issueLinkedWorkForEntry(entry: IssueListEntry): IssueLinkedWork | null {
  const summary = entry.linkedWork;
  if (!summary) return null;
  return {
    issue: {
      provider: entry.provider,
      host: entry.host,
      repository: entry.repository,
      number: entry.number,
    },
    threadId: summary.threadId,
    projectId: entry.projectId,
    branch: summary.branch,
    worktreePath: summary.worktreePath,
    linkedAt: entry.updatedAt,
    source: summary.source,
    state: entry.state,
  };
}

/**
 * GitHub's own search keys, left in the text so the host reads them as written — `is:open`,
 * `no:assignee`, `involves:me`. Without this they would be read as namespaced labels.
 */
const GITHUB_SEARCH_KEYS = new Set([
  "is",
  "no",
  "in",
  "state",
  "reason",
  "sort",
  "repo",
  "org",
  "user",
  "type",
  "mentions",
  "commenter",
  "involves",
  "created",
  "updated",
  "closed",
  "comments",
  "reactions",
  "interactions",
  "linked",
  "project",
]);

/**
 * A typed issue query split into the qualifiers the list request carries as filters and the text
 * that is left: `label:a,b` (either), `-label:x`, `author:`, `assignee:`, `milestone:`. Label
 * parsing is the pull request list's, so `area:web` reads as that label on both pages.
 */
export function parseIssueQuery(raw: string): {
  readonly text: string;
  readonly filters: IssueListFilters;
} {
  const text: string[] = [];
  const labels: string[][] = [];
  const excludedLabels: string[] = [];
  const single: { author?: string; assignee?: string; milestone?: string } = {};
  for (const [token] of raw.matchAll(WORK_ITEM_QUERY_TOKEN)) {
    const qualifier = parseWorkItemQualifier(token);
    if (qualifier === null || qualifier.value.length === 0) {
      text.push(token);
      continue;
    }
    const key = qualifier.key.toLowerCase();
    if (key === "author" || key === "assignee" || key === "milestone") {
      if (qualifier.negated) text.push(token);
      else single[key] = boundedWorkItemQualifier(qualifier.value);
      continue;
    }
    const names = GITHUB_SEARCH_KEYS.has(key)
      ? null
      : workItemQueryLabelNames(qualifier.key, qualifier.rawValue);
    if (names === null || names.length === 0) {
      text.push(token);
      continue;
    }
    if (qualifier.negated) excludedLabels.push(...names);
    else labels.push(names);
  }
  return {
    text: text.join(" "),
    filters: {
      ...(labels.length === 0 ? {} : { labels: labels.slice(0, MAX_WORK_ITEM_QUALIFIER_VALUES) }),
      ...(excludedLabels.length === 0 ? {} : { excludedLabels: excludedLabels.slice(0, 25) }),
      ...single,
    },
  };
}

export function issueEntriesForQuery<Entry extends IssueListEntry>(
  entries: ReadonlyArray<Entry>,
  query: string,
): ReadonlyArray<Entry> {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return entries;
  return entries.filter((entry) => {
    const haystack = [
      entry.title,
      entry.repository,
      entry.author?.login ?? "",
      ...entry.labels.map((label) => label.name),
      String(entry.number),
    ]
      .join(" ")
      .toLowerCase();
    return normalized.split(/\s+/).every((term) => haystack.includes(term));
  });
}

export function normalizeIssueLabelColor(color: string | null | undefined): string | null {
  const normalized = color?.replace(/^#/, "") ?? "";
  return /^[\da-f]{6}$/i.test(normalized) ? `#${normalized.toLowerCase()}` : null;
}

export function issueLabelForeground(color: string): "#000000" | "#ffffff" {
  const normalized = normalizeIssueLabelColor(color);
  if (normalized === null) return "#000000";
  const channels = [1, 3, 5].map((offset) =>
    Number.parseInt(normalized.slice(offset, offset + 2), 16),
  );
  const luminance = channels
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "#000000" : "#ffffff";
}

/**
 * The order the host answers in, applied again where answers from several servers or pages are
 * merged — otherwise a merged list reads in each server's order rather than the reader's.
 */
export function compareIssueEntries(
  left: IssueListEntry,
  right: IssueListEntry,
  sort: IssueListSort = "updated",
): number {
  const order =
    sort === "comments"
      ? right.commentsCount - left.commentsCount
      : sort === "created-asc"
        ? left.createdAt.localeCompare(right.createdAt)
        : sort === "created-desc"
          ? right.createdAt.localeCompare(left.createdAt)
          : right.updatedAt.localeCompare(left.updatedAt);
  return (
    order ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.repository.localeCompare(right.repository) ||
    right.number - left.number
  );
}

export function sortIssueEntries<Entry extends IssueListEntry>(
  entries: ReadonlyArray<Entry>,
  sort: IssueListSort = "updated",
): ReadonlyArray<Entry> {
  return entries.toSorted((left, right) => compareIssueEntries(left, right, sort));
}

export interface MergedIssueList {
  readonly entries: ReadonlyArray<EnvironmentIssueEntry>;
  readonly providers: IssueListResult["providers"];
  readonly errors: IssueListResult["errors"];
  readonly truncatedEnvironments: ReadonlyArray<EnvironmentId>;
  readonly nextCursorsByEnvironment: ReadonlyMap<EnvironmentId, IssueListResult["nextCursors"]>;
}

/**
 * Answers from several servers, or several pages of one, as one list. Each row carries the server
 * it came from; a row read twice (a continuation re-reads a repository that has run out) is kept
 * once; and the merged rows take the reader's sort again, since each answer was only sorted
 * within itself. Paging state comes from each server's latest answer, in the order given.
 */
export function mergeIssueListResults(
  values: ReadonlyArray<readonly [EnvironmentId, IssueListResult]>,
  sort: IssueListSort | undefined,
): MergedIssueList {
  const entries = new Map<string, EnvironmentIssueEntry>();
  const nextCursorsByEnvironment = new Map<EnvironmentId, IssueListResult["nextCursors"]>();
  const truncated = new Map<EnvironmentId, boolean>();
  const providers = new Map<string, IssueListResult["providers"][number]>();
  const errors = new Map<string, IssueListResult["errors"][number]>();
  for (const [environmentId, result] of values) {
    for (const entry of result.entries) {
      const scoped = { ...entry, environmentId };
      entries.set(issueListEntryKey(scoped), scoped);
    }
    for (const provider of result.providers)
      providers.set(`${environmentId}:${provider.host}`, provider);
    for (const error of result.errors) {
      errors.set(`${environmentId}:${error.projectId}:${error.repository}`, error);
    }
    truncated.set(environmentId, result.truncated);
    if (Object.keys(result.nextCursors).length > 0) {
      nextCursorsByEnvironment.set(environmentId, result.nextCursors);
    } else {
      nextCursorsByEnvironment.delete(environmentId);
    }
  }
  return {
    entries: sortIssueEntries([...entries.values()], sort),
    providers: [...providers.values()],
    errors: [...errors.values()],
    truncatedEnvironments: [...truncated].flatMap(([environmentId, value]) =>
      value ? [environmentId] : [],
    ),
    nextCursorsByEnvironment,
  };
}

export interface IssueActorFacet {
  readonly actor: IssueActor;
  readonly count: number;
}

export interface IssueLabelFacet extends Pick<IssueLabel, "name" | "color"> {
  readonly count: number;
}

export interface IssueMilestoneFacet {
  readonly title: string;
  readonly count: number;
}

/** What the loaded rows offer the filter menu, most common first. */
export function collectIssueListFacets(entries: ReadonlyArray<IssueListEntry>): {
  readonly authors: ReadonlyArray<IssueActorFacet>;
  readonly assignees: ReadonlyArray<IssueActorFacet>;
  readonly labels: ReadonlyArray<IssueLabelFacet>;
  readonly milestones: ReadonlyArray<IssueMilestoneFacet>;
} {
  const authors = new Map<string, IssueActorFacet>();
  const assignees = new Map<string, IssueActorFacet>();
  const labels = new Map<string, IssueLabelFacet>();
  const milestones = new Map<string, IssueMilestoneFacet>();
  const countActor = (into: Map<string, IssueActorFacet>, actor: IssueActor) => {
    const key = actor.login.toLowerCase();
    const held = into.get(key);
    into.set(key, { actor: held?.actor ?? actor, count: (held?.count ?? 0) + 1 });
  };
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = issueEntryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    if (entry.author !== null) countActor(authors, entry.author);
    for (const assignee of entry.assignees) countActor(assignees, assignee);
    for (const label of entry.labels) {
      const labelKey = label.name.toLowerCase();
      const held = labels.get(labelKey);
      labels.set(labelKey, {
        name: held?.name ?? label.name,
        color: held?.color ?? label.color,
        count: (held?.count ?? 0) + 1,
      });
    }
    if (entry.milestone !== null) {
      const milestoneKey = entry.milestone.title.toLowerCase();
      const held = milestones.get(milestoneKey);
      milestones.set(milestoneKey, {
        title: held?.title ?? entry.milestone.title,
        count: (held?.count ?? 0) + 1,
      });
    }
  }
  const byCount = <Facet extends { readonly count: number }>(
    facets: Map<string, Facet>,
    name: (facet: Facet) => string,
  ) =>
    [...facets.values()].toSorted(
      (left, right) => right.count - left.count || name(left).localeCompare(name(right)),
    );
  return {
    authors: byCount(authors, (facet) => facet.actor.login),
    assignees: byCount(assignees, (facet) => facet.actor.login),
    labels: byCount(labels, (facet) => facet.name),
    milestones: byCount(milestones, (facet) => facet.title),
  };
}

export type IssueGroupKey = "working" | "assigned" | "others";

const ISSUE_GROUP_LABELS: Record<IssueGroupKey, string> = {
  working: "Working on",
  assigned: "Assigned to you",
  others: "Others",
};

/**
 * The shelves the browse view reads in: issues with a thread already on them, then the ones
 * assigned to the signed-in account, then everything else. A stable partition, so each shelf
 * keeps the order the list was sorted in. Only browsing everything is grouped; a narrowed
 * involvement already is the shelf.
 */
export function groupIssueEntries<Entry extends IssueListEntry>(
  entries: ReadonlyArray<Entry>,
  involvement: IssueInvolvement,
  viewerLogin: string | null,
): ReadonlyArray<{
  readonly key: IssueGroupKey;
  readonly label: string;
  readonly entries: ReadonlyArray<Entry>;
}> {
  if (involvement !== "all") return [{ key: "others", label: "", entries }];
  const viewer = viewerLogin?.toLowerCase() ?? null;
  const buckets: Record<IssueGroupKey, Entry[]> = { working: [], assigned: [], others: [] };
  for (const entry of entries) {
    if (entry.linkedWork) buckets.working.push(entry);
    else if (
      viewer !== null &&
      entry.assignees.some((assignee) => assignee.login.toLowerCase() === viewer)
    ) {
      buckets.assigned.push(entry);
    } else buckets.others.push(entry);
  }
  return (["working", "assigned", "others"] as const)
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, label: ISSUE_GROUP_LABELS[key], entries: buckets[key] }));
}

export type IssueBulkAction =
  | { readonly kind: "close"; readonly reason: "completed" | "not-planned" }
  | { readonly kind: "reopen" }
  | { readonly kind: "add-label"; readonly label: string }
  | { readonly kind: "assign"; readonly login: string };

export type IssueBulkStep<Entry extends IssueListEntry> =
  | { readonly entry: Entry; readonly command: "close"; readonly input: IssueCloseInput }
  | { readonly entry: Entry; readonly command: "reopen"; readonly input: IssueReopenInput }
  | { readonly entry: Entry; readonly command: "update"; readonly input: IssueUpdateInput };

/** GitHub's own ceiling on labels or assignees set in one update. */
const MAX_ISSUE_UPDATE_VALUES = 25;

function withName(names: ReadonlyArray<string>, name: string): ReadonlyArray<string> | null {
  if (names.some((existing) => existing.toLowerCase() === name.toLowerCase())) return null;
  return names.length >= MAX_ISSUE_UPDATE_VALUES ? null : [...names, name];
}

/**
 * One request per selected issue that the action would actually change. Closing a closed issue,
 * reopening an open one, or adding a label it already carries is left out rather than sent, so
 * the progress count only counts real work. Labels and assignees are sent whole, since an update
 * replaces the set: the row's own set plus the new name.
 */
export function planIssueBulkAction<Entry extends IssueListEntry>(
  entries: ReadonlyArray<Entry>,
  action: IssueBulkAction,
): ReadonlyArray<IssueBulkStep<Entry>> {
  return entries.flatMap((entry): ReadonlyArray<IssueBulkStep<Entry>> => {
    const ref = issueRefForEntry(entry);
    switch (action.kind) {
      case "close":
        return entry.state === "open"
          ? [{ entry, command: "close", input: { ...ref, reason: action.reason } }]
          : [];
      case "reopen":
        return entry.state === "closed" ? [{ entry, command: "reopen", input: ref }] : [];
      case "add-label": {
        const labels = withName(
          entry.labels.map((label) => label.name),
          action.label.trim(),
        );
        return labels === null ? [] : [{ entry, command: "update", input: { ...ref, labels } }];
      }
      case "assign": {
        const assignees = withName(
          entry.assignees.map((assignee) => assignee.login),
          action.login.trim(),
        );
        return assignees === null
          ? []
          : [{ entry, command: "update", input: { ...ref, assignees } }];
      }
    }
  });
}

export function issueDeletePreflightSummary(
  items: ReadonlyArray<IssueWorktreeDeletePreflightItem>,
): {
  readonly deletable: number;
  readonly blocked: number;
  readonly forceRequired: number;
} {
  return items.reduce(
    (summary, item) => ({
      deletable: summary.deletable + Number(item.canDelete),
      blocked: summary.blocked + Number(item.blocked || !item.canDelete),
      forceRequired: summary.forceRequired + Number(item.requiresForce),
    }),
    { deletable: 0, blocked: 0, forceRequired: 0 },
  );
}

/**
 * Names one list question for the cached snapshot: the scope (every project, or one checkout on
 * one server) and everything the request carries. A different question never reads another's
 * rows, which would show issues the filters exclude.
 */
export function issueListSnapshotKey(input: {
  readonly scope: string;
  readonly state: string;
  readonly involvement: string;
  readonly sort: string;
  readonly filters: IssueListFilters;
  readonly query: string;
}): string {
  return JSON.stringify([
    input.scope,
    input.state,
    input.involvement,
    input.sort,
    input.filters,
    input.query.trim().toLowerCase(),
  ]);
}

/**
 * The repositories a continuation still has pages for. The server keys each cursor
 * `projectId:host:owner/name` with the host it resolved, so the match ignores the host; with no
 * match at all every repository is asked again rather than none.
 */
export function issueRepositoriesWithCursors(
  repositories: ReadonlyArray<IssueRepositorySelection>,
  cursors: Readonly<Record<string, string>>,
): ReadonlyArray<IssueRepositorySelection> {
  const keys = Object.keys(cursors).map((key) => key.toLowerCase());
  const continuing = repositories.filter((repository) =>
    keys.some(
      (key) =>
        key.startsWith(`${repository.projectId.toLowerCase()}:`) &&
        key.endsWith(`:${repository.repository.toLowerCase()}`),
    ),
  );
  return continuing.length === 0 ? repositories : continuing;
}

/** The scope part of a snapshot key for one selected checkout. */
export function issueSelectionScopeKey(
  environmentId: EnvironmentId,
  selection: IssueRepositorySelection,
): string {
  return JSON.stringify([
    environmentId,
    selection.projectId,
    normalizeIssueHost(selection.host ?? "github.com"),
    selection.repository.toLowerCase(),
  ]);
}

export interface IssueLinkRepository {
  readonly host: string;
  readonly repository: string;
}

export function findProjectForIssue(
  projects: ReadonlyArray<EnvironmentProject>,
  link: IssueLinkRepository,
): EnvironmentProject | undefined {
  const host = normalizeIssueHost(link.host);
  const repository = link.repository.trim().toLowerCase();
  return projects.find((project) => {
    const descriptor = issueRepositoryForProject(project);
    return (
      descriptor !== null &&
      descriptor.host === host &&
      descriptor.repository.toLowerCase() === repository
    );
  });
}

export type IssueWorktreeAction = "create" | "replace" | "open-linked";

export function selectIssueWorktreeAction(input: {
  readonly linkedWork: { readonly threadId: string; readonly worktreePath: string | null } | null;
  readonly detachedWorkspacePath?: string | null;
}): IssueWorktreeAction {
  if (input.linkedWork?.threadId) return "open-linked";
  if (input.detachedWorkspacePath) return "replace";
  return "create";
}

export function issueWorktreeIsLinked(
  thread: { readonly id: string; readonly worktreePath: string | null },
  linkedWork: IssueLinkedWork | null,
): boolean {
  if (linkedWork === null) return false;
  if (thread.id === linkedWork.threadId) return true;
  return (
    thread.worktreePath !== null &&
    linkedWork.worktreePath !== null &&
    normalizeProjectPathForComparison(thread.worktreePath) ===
      normalizeProjectPathForComparison(linkedWork.worktreePath)
  );
}

export function issueWorktreePrimaryAction(input: {
  readonly canLink: boolean;
  readonly hasLinkedWork: boolean;
}): "link-issue" | "new-thread" {
  return input.canLink && !input.hasLinkedWork ? "link-issue" : "new-thread";
}
