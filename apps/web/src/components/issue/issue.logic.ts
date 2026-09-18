import type {
  IssueListEntry,
  IssueRepositorySelection,
  IssueWorktreeDeletePreflightItem,
  ProjectId,
} from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
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

export function issueEntriesForQuery(
  entries: ReadonlyArray<IssueListEntry>,
  query: string,
): ReadonlyArray<IssueListEntry> {
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

export function sortIssueEntries(
  entries: ReadonlyArray<IssueListEntry>,
): ReadonlyArray<IssueListEntry> {
  return [...entries].sort(
    (left, right) =>
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
      right.number - left.number ||
      left.repository.localeCompare(right.repository),
  );
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

export function issueListSnapshotKey(
  selection: IssueRepositorySelection,
  state: string,
  query: string,
): string {
  return JSON.stringify([
    selection.projectId,
    normalizeIssueHost(selection.host ?? "github.com"),
    selection.repository.toLowerCase(),
    state,
    query.trim().toLowerCase(),
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
