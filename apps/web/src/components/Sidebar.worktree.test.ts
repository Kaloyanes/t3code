import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildSidebarRepositoryGroups,
  buildWorktreeActionMenuItems,
  findWorktreeThreads,
} from "./Sidebar";

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

const worktreeIssue = {
  issue: {
    provider: "github" as const,
    host: "github.com",
    repository: "acme/repo",
    number: 17,
  },
  threadId: ThreadId.make("first"),
  projectId,
  branch: "feature",
  worktreePath: "/worktrees/feature",
  linkedAt: "2026-09-01T00:00:00.000Z",
  source: "created" as const,
};

const project = {
  id: projectId,
  environmentId,
  title: "Repo",
  workspaceRoot: "/repo",
  defaultModelSelection: null,
  scripts: [],
  worktreePullRequests: [worktreeLink],
  worktreeIssues: [worktreeIssue],
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
    expect(groups[0]?.worktrees[0]?.issues).toEqual([worktreeIssue]);
  });

  it("keeps discovered worktrees that have no active threads", () => {
    const groups = buildSidebarRepositoryGroups({
      projectGroups: [projectGroup],
      pinnedThreads: [],
      activeThreads: [thread("first")],
      discoveredWorktrees: [
        {
          environmentId,
          projectId,
          path: "/repo",
          branch: "main",
          primary: true,
        },
        {
          environmentId,
          projectId,
          path: "/worktrees/empty",
          branch: "feature/empty",
          primary: false,
        },
      ],
    });

    expect(
      groups[0]?.worktrees.map(({ label, primary, threads }) => [label, primary, threads.length]),
    ).toEqual([
      ["Local checkout", true, 0],
      ["feature", false, 1],
      ["feature/empty", false, 0],
    ]);
  });

  it("keeps local branches in one local checkout group alongside actual worktrees", () => {
    const first = { ...thread("local-first"), branch: "main", worktreePath: null };
    const second = { ...thread("local-second"), branch: "feature/local", worktreePath: null };
    const groups = buildSidebarRepositoryGroups({
      projectGroups: [projectGroup],
      pinnedThreads: [first],
      activeThreads: [second, thread("worktree")],
      discoveredWorktrees: [
        { environmentId, projectId, path: "/repo", branch: "main", primary: true },
      ],
    });

    expect(groups[0]?.worktrees).toHaveLength(2);
    expect(groups[0]?.worktrees[0]).toMatchObject({
      label: "Local checkout",
      path: "/repo",
      primary: true,
      threads: [first, second],
    });
    expect(groups[0]?.worktrees[1]).toMatchObject({
      label: "feature",
      path: "/worktrees/feature",
      primary: false,
    });
  });

  it("hides discovered worktrees outside the selected project scope", () => {
    const otherProjectId = ProjectId.make("other-project");
    const otherProject = {
      ...project,
      id: otherProjectId,
      title: "Other Repo",
      workspaceRoot: "/other-repo",
      physicalProjectKey: `${environmentId}:${otherProjectId}`,
    };
    const otherProjectGroup = {
      ...projectGroup,
      ...otherProject,
      projectKey: "other-repo",
      displayName: "Other Repo",
      memberProjects: [otherProject],
      memberProjectRefs: [{ environmentId, projectId: otherProjectId }],
    };

    const groups = buildSidebarRepositoryGroups({
      projectGroups: [projectGroup, otherProjectGroup],
      pinnedThreads: [],
      activeThreads: [],
      discoveredWorktrees: [
        { environmentId, projectId, path: "/repo", branch: "main", primary: true },
        {
          environmentId,
          projectId: otherProjectId,
          path: "/other-repo",
          branch: "main",
          primary: true,
        },
      ],
      scopedProjectKeys: new Set([`${environmentId}:${projectId}`]),
    });

    expect(groups.map((group) => group.project.projectKey)).toEqual(["repo"]);
  });
});

describe("worktree action menu", () => {
  it("labels deletion as a worktree action and omits it for the primary checkout", () => {
    const menu = buildWorktreeActionMenuItems({
      branch: "feature/menu",
      primary: false,
      scripts: [
        {
          id: "dev",
          name: "Dev",
          command: "vp dev",
          icon: "play",
          runOnWorktreeCreate: false,
          scope: "worktree",
        },
      ],
      deletionBlocked: false,
    });

    expect(menu.find((item) => item.id === "run-actions")?.children?.[0]?.label).toBe("Dev");
    expect(menu.find((item) => item.id === "delete-worktree")).toMatchObject({
      label: "Delete worktree…",
      destructive: true,
    });
    expect(
      buildWorktreeActionMenuItems({
        branch: "main",
        primary: true,
        scripts: [],
        deletionBlocked: false,
      }).some((item) => item.id === "delete-worktree"),
    ).toBe(false);
  });

  it("explains why deletion is disabled", () => {
    const menu = buildWorktreeActionMenuItems({
      branch: "feature/menu",
      primary: false,
      scripts: [],
      deletionBlocked: true,
      deletionBlockReason: "agent running",
    });
    expect(menu.find((item) => item.id === "delete-worktree")).toMatchObject({
      label: "Delete worktree (agent running)",
      disabled: true,
    });
  });
});

describe("worktree deletion links", () => {
  it("includes parked and archived threads sharing the path", () => {
    const active = thread("active");
    const archived = { ...thread("archived"), archivedAt: "2026-09-02T00:00:00.000Z" };
    const otherEnvironment = {
      ...thread("remote"),
      environmentId: EnvironmentId.make("other"),
    };
    expect(
      findWorktreeThreads(
        [active, archived, otherEnvironment, { ...thread("local"), worktreePath: null }],
        environmentId,
        "/worktrees/feature/",
      ).map((item) => item.id),
    ).toEqual([active.id, archived.id]);
  });
});
