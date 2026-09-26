import { describe, expect, it } from "vite-plus/test";

import {
  projectGroupTitleNeedsUpdate,
  resolveProjectWorktreeOptions,
} from "./ProjectSettingsPanel.logic";

describe("resolveProjectWorktreeOptions", () => {
  it("uses checkout paths and includes a main worktree on master", () => {
    expect(
      resolveProjectWorktreeOptions({
        workspaceRoot: "/repo/app",
        repositoryRoot: "/unknown",
        refs: [
          { name: "master", current: true, worktreePath: "/repo" },
          { name: "feature", current: false, worktreePath: "/worktrees/feature" },
        ],
      }),
    ).toEqual([
      { branch: "master", worktreePath: "/repo/app" },
      { branch: "feature", worktreePath: "/worktrees/feature/app", label: "feature" },
    ]);
  });

  it("returns no options when Git reports no worktrees", () => {
    expect(
      resolveProjectWorktreeOptions({ refs: [], workspaceRoot: "/repo", repositoryRoot: "/repo" }),
    ).toEqual([]);
  });

  it("leaves a stale current checkout unselected while keeping live worktrees available", () => {
    expect(
      resolveProjectWorktreeOptions({
        workspaceRoot: "/repo",
        repositoryRoot: "/repo",
        refs: [{ name: "next", current: false, worktreePath: "/worktrees/next" }],
      }),
    ).toEqual([{ branch: "next", worktreePath: "/worktrees/next", label: "next" }]);
  });
});

describe("projectGroupTitleNeedsUpdate", () => {
  it("updates divergent member titles even when the next title is the derived group label", () => {
    expect(
      projectGroupTitleNeedsUpdate(["local-title", "remote-title"], "Repository name", true),
    ).toBe(true);
  });

  it("skips an untouched blur when the derived label differs from member titles", () => {
    expect(projectGroupTitleNeedsUpdate(["repo-slug", "repo-slug"], "Repository Name", false)).toBe(
      false,
    );
  });

  it("skips an update when every member already has the next title", () => {
    expect(projectGroupTitleNeedsUpdate(["Shared name", "Shared name"], "Shared name", true)).toBe(
      false,
    );
  });
});
