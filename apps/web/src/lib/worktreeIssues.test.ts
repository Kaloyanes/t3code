import { ProjectId, ThreadId, type IssueLinkedWork } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { findWorktreeIssue } from "./worktreeIssues";

const issue = (number: number, worktreePath: string | null): IssueLinkedWork => ({
  issue: {
    provider: "github",
    host: "github.com",
    repository: "acme/repo",
    number,
  },
  threadId: ThreadId.make(`thread-${number}`),
  projectId: ProjectId.make("project"),
  branch: `issue-${number}`,
  worktreePath,
  linkedAt: "2026-09-19T00:00:00.000Z",
  source: "created",
});

describe("findWorktreeIssue", () => {
  it("finds an issue linked by another thread in the same worktree", () => {
    expect(
      findWorktreeIssue({
        issues: [issue(41, "/worktrees/other"), issue(42, "/worktrees/feature/")],
        workspacePath: "/worktrees/feature",
        projectRoot: "/repo",
      })?.issue.number,
    ).toBe(42);
  });

  it("matches a primary-checkout link with no explicit worktree path", () => {
    expect(
      findWorktreeIssue({
        issues: [issue(42, null)],
        workspacePath: "/repo/",
        projectRoot: "/repo",
      })?.issue.number,
    ).toBe(42);
  });

  it("does not expose an issue from another worktree", () => {
    expect(
      findWorktreeIssue({
        issues: [issue(42, "/worktrees/feature")],
        workspacePath: "/worktrees/unrelated",
        projectRoot: "/repo",
      }),
    ).toBeNull();
  });
});
