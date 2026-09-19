import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildSidebarRepositoryGroups } from "./Sidebar";

const environmentId = EnvironmentId.make("environment");
const projectId = ProjectId.make("project");

const worktreeLink = {
  projectId,
  worktreePath: "/worktrees/feature",
  host: "github.com",
  repository: "acme/repo",
  number: 42,
  url: "https://github.com/acme/repo/pull/42",
  source: "created" as const,
  linkedAt: "2026-09-01T00:00:00.000Z",
  snapshot: null,
  stack: null,
};

const project = {
  id: projectId,
  environmentId,
  title: "Repo",
  workspaceRoot: "/repo",
  defaultModelSelection: null,
  scripts: [],
  worktreePullRequests: [worktreeLink],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  physicalProjectKey: `${environmentId}:${projectId}`,
  environmentLabel: null,
};

const projectGroup = {
  ...project,
  projectKey: "repo",
  displayName: "Repo",
  groupedProjectCount: 1,
  environmentPresence: "local-only" as const,
  allRemoteMembersAreDesktopLocal: false,
  allRemoteMembersAreWsl: false,
  memberProjects: [project],
  memberProjectRefs: [{ environmentId, projectId }],
  remoteEnvironmentLabels: [],
};

function thread(id: string) {
  return {
    id: ThreadId.make(id),
    environmentId,
    projectId,
    title: id,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    branch: "feature",
    worktreePath: "/worktrees/feature",
    pullRequests: [],
    session: null,
    latestTurn: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    latestUserMessageAt: "2026-09-01T00:00:00.000Z",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

describe("sidebar worktree grouping", () => {
  it("carries a worktree PR to the shared worktree header", () => {
    const groups = buildSidebarRepositoryGroups({
      projectGroups: [projectGroup],
      pinnedThreads: [],
      activeThreads: [thread("first"), thread("second")],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.worktrees).toHaveLength(1);
    expect(groups[0]?.worktrees[0]?.threads).toHaveLength(2);
    expect(groups[0]?.worktrees[0]?.pullRequests).toEqual([worktreeLink]);
  });
});
