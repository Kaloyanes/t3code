import type {
  EnvironmentId,
  EnvironmentMachineKind,
  VcsRef,
  ProjectId,
  WorktreeSubmodules,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
export {
  dedupeRemoteBranchesWithLocalMatches,
  deriveLocalBranchNameFromRemoteRef,
} from "@t3tools/shared/git";

export interface EnvironmentOption {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  label: string;
  isPrimary: boolean;
  machine: EnvironmentMachineKind;
}

export const EnvMode = Schema.Literals(["local", "worktree"]);
export type EnvMode = typeof EnvMode.Type;

const GENERIC_LOCAL_ENVIRONMENT_LABELS = new Set(["local", "local environment"]);

function normalizeDisplayLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function resolveEnvironmentOptionLabel(input: {
  isPrimary: boolean;
  environmentId: EnvironmentId;
  runtimeLabel?: string | null;
  savedLabel?: string | null;
}): string {
  const runtimeLabel = normalizeDisplayLabel(input.runtimeLabel);
  const savedLabel = normalizeDisplayLabel(input.savedLabel);

  if (input.isPrimary) {
    const preferredLocalLabel = [runtimeLabel, savedLabel].find((label) => {
      if (!label) return false;
      return !GENERIC_LOCAL_ENVIRONMENT_LABELS.has(label.toLowerCase());
    });
    return preferredLocalLabel ?? "This device";
  }

  return runtimeLabel ?? savedLabel ?? input.environmentId;
}

// A remote (non-primary) environment is always surfaced, even when it is the
// only environment available: with a single connected machine there is nothing
// to pick, but the user still needs to see where the project runs.
export function shouldShowEnvironmentIndicator(input: {
  activeEnvironment: Pick<EnvironmentOption, "isPrimary"> | null;
  canPickEnvironment: boolean;
}): boolean {
  if (input.canPickEnvironment) return true;
  return input.activeEnvironment !== null && !input.activeEnvironment.isPrimary;
}

export function shouldShowComposerContextStrip(input: {
  hasActiveProject: boolean;
  isGitRepo: boolean;
  showEnvironmentIndicator: boolean;
  /** A collapsed composer's controls currently fit in their measured strip host. */
  hostsRestingComposerControls: boolean;
}): boolean {
  return (
    input.hasActiveProject &&
    (input.isGitRepo || input.showEnvironmentIndicator || input.hostsRestingComposerControls)
  );
}

// Labels collapse to icons when the strip's content no longer fits. A small
// hysteresis on the way back out keeps the boundary from flapping.
const CONTEXT_STRIP_COMPACT_EXPAND_HYSTERESIS_PX = 16;

export function resolveContextStripLabelsCompact(input: {
  compact: boolean;
  neededWidth: number;
  availableWidth: number;
}): boolean {
  return input.compact
    ? input.neededWidth > input.availableWidth - CONTEXT_STRIP_COMPACT_EXPAND_HYSTERESIS_PX
    : input.neededWidth > input.availableWidth;
}

export function resolveEnvModeLabel(mode: EnvMode): string {
  return mode === "worktree" ? "New worktree" : "Current checkout";
}

export const WORKTREE_SUBMODULES_LABELS: Record<WorktreeSubmodules, string> = {
  recursive: "Recursive",
  "top-level": "Top level only",
  none: "Skip",
};

export function resolveCurrentWorkspaceLabel(
  activeWorktreePath: string | null,
  currentBranch?: string | null,
): string {
  const label = activeWorktreePath ? "Current worktree" : resolveEnvModeLabel("local");
  return currentBranch ? `${label} (${currentBranch})` : label;
}

export function resolveLockedWorkspaceLabel(activeWorktreePath: string | null): string {
  return activeWorktreePath ? "Worktree" : "Local checkout";
}

export interface ExistingWorktreeOption {
  readonly branch: string;
  readonly worktreePath: string;
  readonly label: string;
}

export function resolveWorktreeDisplayLabel(
  path: string,
  branch: string | null,
  options: ReadonlyArray<ExistingWorktreeOption>,
): string {
  return (
    options.find((option) => option.worktreePath === path)?.label ??
    branch ??
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ??
    "Worktree"
  );
}

export function resolveExistingWorktreeOptions(input: {
  readonly refs: ReadonlyArray<Pick<VcsRef, "name" | "worktreePath">>;
  readonly workspaceRoot: string;
  readonly repositoryRoot?: string | null;
}): ReadonlyArray<ExistingWorktreeOption> {
  const separator = input.workspaceRoot.includes("\\") ? "\\" : "/";
  const workspaceRoot = input.workspaceRoot.replace(/[\\/]+$/, "");
  const repositoryRoot = (input.repositoryRoot ?? input.workspaceRoot).replace(/[\\/]+$/, "");
  const caseInsensitive = separator === "\\";
  const normalizedWorkspaceRoot = caseInsensitive ? workspaceRoot.toLowerCase() : workspaceRoot;
  const normalizedRepositoryRoot = caseInsensitive ? repositoryRoot.toLowerCase() : repositoryRoot;
  const relativeProjectPath =
    normalizedWorkspaceRoot === normalizedRepositoryRoot
      ? ""
      : normalizedWorkspaceRoot.startsWith(`${normalizedRepositoryRoot}${separator}`)
        ? workspaceRoot.slice(repositoryRoot.length)
        : "";
  const byPath = new Map<string, ExistingWorktreeOption>();
  for (const ref of input.refs) {
    if (!ref.worktreePath) continue;
    const worktreeRoot = ref.worktreePath.replace(/[\\/]+$/, "");
    const worktreePath = `${worktreeRoot}${relativeProjectPath}`;
    const pathKey = caseInsensitive ? worktreePath.toLowerCase() : worktreePath;
    if (pathKey === normalizedWorkspaceRoot || byPath.has(pathKey)) continue;
    byPath.set(pathKey, {
      branch: ref.name,
      worktreePath,
      label: ref.name,
    });
  }
  return [...byPath.values()].sort(
    (left, right) =>
      left.label.localeCompare(right.label) || left.worktreePath.localeCompare(right.worktreePath),
  );
}

export function resolvePreviousWorktreeOption(input: {
  readonly currentWorktreePath: string | null;
  readonly options: ReadonlyArray<ExistingWorktreeOption>;
  readonly threads: ReadonlyArray<{
    readonly worktreePath: string | null;
    readonly updatedAt: string;
    readonly archivedAt?: string | null;
  }>;
}): ExistingWorktreeOption | null {
  const optionsByPath = new Map(input.options.map((option) => [option.worktreePath, option]));
  let latest: { option: ExistingWorktreeOption; updatedAt: number } | null = null;
  for (const thread of input.threads) {
    if (
      !thread.worktreePath ||
      thread.worktreePath === input.currentWorktreePath ||
      thread.archivedAt
    ) {
      continue;
    }
    const option = optionsByPath.get(thread.worktreePath);
    const updatedAt = Date.parse(thread.updatedAt);
    if (!option || !Number.isFinite(updatedAt)) continue;
    if (!latest || updatedAt > latest.updatedAt) latest = { option, updatedAt };
  }
  return latest?.option ?? null;
}

export function resolveEffectiveEnvMode(input: {
  activeWorktreePath: string | null;
  hasServerThread: boolean;
  draftThreadEnvMode: EnvMode | undefined;
}): EnvMode {
  const { activeWorktreePath, hasServerThread, draftThreadEnvMode } = input;
  if (!hasServerThread) {
    if (activeWorktreePath) {
      return "local";
    }
    return draftThreadEnvMode === "worktree" ? "worktree" : "local";
  }
  return activeWorktreePath ? "worktree" : "local";
}

export function resolveDraftEnvModeAfterBranchChange(input: {
  nextWorktreePath: string | null;
  currentWorktreePath: string | null;
  effectiveEnvMode: EnvMode;
}): EnvMode {
  const { nextWorktreePath, currentWorktreePath, effectiveEnvMode } = input;
  if (nextWorktreePath) {
    return "worktree";
  }
  if (effectiveEnvMode === "worktree" && !currentWorktreePath) {
    return "worktree";
  }
  return "local";
}

export function resolveBranchToolbarValue(input: {
  envMode: EnvMode;
  activeWorktreePath: string | null;
  activeThreadBranch: string | null;
  currentGitBranch: string | null;
}): string | null {
  const { envMode, activeWorktreePath, activeThreadBranch, currentGitBranch } = input;
  if (envMode === "worktree" && !activeWorktreePath) {
    return activeThreadBranch ?? currentGitBranch;
  }
  return currentGitBranch ?? activeThreadBranch;
}

export function resolveBranchTriggerLabel(input: {
  activeWorktreePath: string | null;
  effectiveEnvMode: EnvMode;
  resolvedActiveBranch: string | null;
  resolvedActiveBranchIsRemote: boolean | null;
  startFromOrigin: boolean;
}): string {
  const {
    activeWorktreePath,
    effectiveEnvMode,
    resolvedActiveBranch,
    resolvedActiveBranchIsRemote,
    startFromOrigin,
  } = input;
  if (!resolvedActiveBranch) {
    return "Select ref";
  }
  if (effectiveEnvMode === "worktree" && !activeWorktreePath) {
    const baseRef =
      startFromOrigin && resolvedActiveBranchIsRemote === false
        ? `origin/${resolvedActiveBranch}`
        : resolvedActiveBranch;
    return `From ${baseRef}`;
  }
  return resolvedActiveBranch;
}

export function resolveBranchToolbarPrBranch(input: {
  activeThreadBranch: string | null;
  resolvedActiveBranch: string | null;
}): string | null {
  return input.activeThreadBranch === input.resolvedActiveBranch ? input.activeThreadBranch : null;
}

export function resolveLocalCheckoutBranchMismatch(input: {
  effectiveEnvMode: EnvMode;
  activeWorktreePath: string | null;
  activeThreadBranch: string | null;
  currentGitBranch: string | null;
}): { threadBranch: string; currentBranch: string } | null {
  const { effectiveEnvMode, activeWorktreePath, activeThreadBranch, currentGitBranch } = input;
  if (effectiveEnvMode !== "local" || activeWorktreePath !== null) {
    return null;
  }
  if (!activeThreadBranch || !currentGitBranch || activeThreadBranch === currentGitBranch) {
    return null;
  }
  return { threadBranch: activeThreadBranch, currentBranch: currentGitBranch };
}

export function resolveBranchSelectionTarget(input: {
  activeProjectCwd: string;
  activeWorktreePath: string | null;
  refName: Pick<VcsRef, "worktreePath">;
}): {
  checkoutCwd: string;
  nextWorktreePath: string | null;
  reuseExistingWorktree: boolean;
} {
  const { activeProjectCwd, activeWorktreePath, refName } = input;

  if (refName.worktreePath) {
    return {
      checkoutCwd: refName.worktreePath,
      nextWorktreePath: refName.worktreePath === activeProjectCwd ? null : refName.worktreePath,
      reuseExistingWorktree: true,
    };
  }

  return {
    checkoutCwd: activeWorktreePath ?? activeProjectCwd,
    nextWorktreePath: activeWorktreePath,
    reuseExistingWorktree: false,
  };
}

// Git rejects ASCII space and the ASCII control characters (tab, newline and
// friends) in ref names, so the picker's "Create new ref" entry can only fail
// for a typed name like "new branch". Replacing runs of those with a dash makes
// the name usable without reimplementing check-ref-format: names invalid for
// other reasons still surface the git error. Only the whitespace git actually
// rejects is replaced — git accepts U+00A0 and friends, and rewriting those
// would silently create a ref the user never asked for. Case and existing
// dashes are left alone, since ref names are case sensitive and consecutive
// dashes are valid.
export function sanitizeNewRefName(rawName: string): string {
  return rawName.trim().replace(/[ \t\n\r\f\v]+/g, "-");
}

export function shouldIncludeBranchPickerItem(input: {
  itemValue: string;
  normalizedQuery: string;
  createBranchItemValue: string | null;
  checkoutPullRequestItemValue: string | null;
}): boolean {
  const { itemValue, normalizedQuery, createBranchItemValue, checkoutPullRequestItemValue } = input;

  if (normalizedQuery.length === 0) {
    return true;
  }

  if (createBranchItemValue && itemValue === createBranchItemValue) {
    return true;
  }

  if (checkoutPullRequestItemValue && itemValue === checkoutPullRequestItemValue) {
    return true;
  }

  const lowerItemValue = itemValue.toLowerCase();
  if (lowerItemValue.includes(normalizedQuery)) {
    return true;
  }

  // A query containing whitespace can only ever match a ref under its sanitized
  // name, because that is the name such a ref would have been created with.
  // Without this, typing "new branch" hides an existing "new-branch".
  const sanitizedQuery = sanitizeNewRefName(normalizedQuery);
  return (
    sanitizedQuery.length > 0 &&
    sanitizedQuery !== normalizedQuery &&
    lowerItemValue.includes(sanitizedQuery)
  );
}
