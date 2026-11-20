import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isPickableProjectMember,
  pickableProjectGroups,
  selectProjectGroupingSettings,
  type ProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@t3tools/contracts";

import {
  readIssueListPreferences,
  type IssueListPreferences,
} from "../components/issue/issueListPreferences";
import {
  readPullRequestListPreferences,
  type PullRequestListPreferences,
} from "../components/pullRequest/pullRequestListPreferences";
import { getClientSettings } from "../hooks/useSettings";
import { isInProjectScope } from "./chatThreadActions";
import { appAtomRegistry } from "../rpc/atomRegistry";
import {
  buildSidebarProjectSnapshots,
  resolveSidebarProjectScopeKeys,
  type SidebarProjectSnapshot,
} from "../sidebarProjectGrouping";
import { readProjects } from "../state/entities";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import type { Project } from "../types";
import { useUiStateStore } from "../uiStateStore";

type ProjectPair = readonly [EnvironmentId, ProjectId];
type ProjectRefLike = { readonly environmentId: EnvironmentId; readonly id: ProjectId };

/** The open project groups the sidebar filter names; empty when it shows every project. */
export function resolveSidebarScopeGroups(input: {
  readonly projects: ReadonlyArray<Project>;
  readonly settings: ProjectGroupingSettings;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly keys: ReadonlyArray<string>;
}): SidebarProjectSnapshot[] {
  if (input.keys.length === 0) return [];
  const groups = buildSidebarProjectSnapshots({
    projects: input.projects,
    groupScratchProjects: true,
    settings: input.settings,
    primaryEnvironmentId: input.primaryEnvironmentId,
    resolveEnvironmentLabel: () => null,
  });
  const keys = resolveSidebarProjectScopeKeys({
    groups,
    keys: input.keys,
    settings: input.settings,
    canClearMissingScope: true,
  });
  return pickableProjectGroups(groups).filter((group) => keys.includes(group.projectKey));
}

export function sidebarScopeProjectRefs(
  groups: ReadonlyArray<SidebarProjectSnapshot>,
): ScopedProjectRef[] {
  return groups.flatMap((group) =>
    group.memberProjects
      .filter(isPickableProjectMember)
      .map((project) => scopeProjectRef(project.environmentId, project.id)),
  );
}

/** Issues hide every project outside the scope; an empty scope shows every project. */
export function issueSearchInProjectScope<T extends { readonly hideProjects?: unknown }>(
  search: T,
  scope: ReadonlyArray<ScopedProjectRef>,
  projects: ReadonlyArray<ProjectRefLike>,
): Omit<T, "hideProjects"> & { hideProjects?: ReadonlyArray<ProjectPair> } {
  const { hideProjects: _previous, ...rest } = search;
  const hidden = projects
    .filter(
      (project) => !isInProjectScope(scope, scopeProjectRef(project.environmentId, project.id)),
    )
    .map((project): ProjectPair => [project.environmentId, project.id]);
  return scope.length === 0 || hidden.length === 0 ? rest : { ...rest, hideProjects: hidden };
}

/**
 * The pull request list filters to one project, so it follows a scope of one project group and
 * keeps its own project otherwise. An empty scope shows every project.
 */
export function pullRequestSearchInProjectScope<
  T extends { readonly projectId?: ProjectId; readonly environmentId?: EnvironmentId },
>(
  search: T,
  groups: ReadonlyArray<SidebarProjectSnapshot>,
): Omit<T, "projectId" | "environmentId"> & {
  projectId?: ProjectId;
  environmentId?: EnvironmentId;
} {
  const { projectId, environmentId, ...rest } = search;
  if (groups.length === 0) return rest;
  if (groups.length > 1) return search;
  const members = groups[0]!.memberProjects.filter(isPickableProjectMember);
  const target =
    members.find((member) => member.id === projectId && member.environmentId === environmentId) ??
    members.find(
      (member) => member.id === groups[0]!.id && member.environmentId === groups[0]!.environmentId,
    ) ??
    members[0];
  return target ? { ...rest, projectId: target.id, environmentId: target.environmentId } : search;
}

export function readSidebarScopeGroups(): SidebarProjectSnapshot[] {
  return resolveSidebarScopeGroups({
    projects: readProjects(),
    settings: selectProjectGroupingSettings(getClientSettings()),
    primaryEnvironmentId: appAtomRegistry.get(primaryEnvironmentIdAtom),
    keys: useUiStateStore.getState().sidebarProjectScopeKeys,
  });
}

/** The issues page opens on its remembered list, narrowed to the sidebar's projects when filtered. */
export function readIssueListSearch(): IssueListPreferences {
  const preferences = readIssueListPreferences();
  const scope = sidebarScopeProjectRefs(readSidebarScopeGroups());
  return scope.length === 0
    ? preferences
    : issueSearchInProjectScope(preferences, scope, readProjects());
}

export function readPullRequestListSearch(): PullRequestListPreferences {
  const preferences = readPullRequestListPreferences();
  const groups = readSidebarScopeGroups();
  return groups.length === 0 ? preferences : pullRequestSearchInProjectScope(preferences, groups);
}
