import { describe, expect, it } from "@effect/vitest";

import {
  isSafeIssueWorktreePath,
  issueWorktreeBranch,
  issueWorktreeFragment,
  normalizeIssue,
} from "./IssueService.ts";
import { ProjectId } from "@t3tools/contracts";

describe("IssueService pure issue helpers", () => {
  it("normalizes a GitHub issue without trusting missing fields", () => {
    const issue = normalizeIssue(
      {
        number: 42,
        title: "  Fix the checkout  ",
        state: "OPEN",
        author: { login: "octocat", name: null, avatarUrl: null },
        labels: { nodes: [{ name: "bug", color: "b60205" }] },
        comments: { totalCount: 3 },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
      { projectId: ProjectId.make("project-1"), host: "github.com", repository: "owner/repo" },
    );

    expect(issue).not.toBeNull();
    expect(issue?.title).toBe("Fix the checkout");
    expect(issue?.state).toBe("open");
    expect(issue?.commentsCount).toBe(3);
    expect(issue?.labels[0]?.name).toBe("bug");
  });

  it("rejects malformed issue numbers", () => {
    expect(
      normalizeIssue(
        { number: 0, title: "bad" },
        { projectId: ProjectId.make("project-1"), host: "github.com", repository: "owner/repo" },
      ),
    ).toBeNull();
  });

  it("makes deterministic sanitized issue branches", () => {
    expect(issueWorktreeFragment(42, " Fix / checkout ")).toBe("42-fix-checkout");
    expect(issueWorktreeBranch(42, " Fix / checkout ")).toBe("t3code/42-fix-checkout");
    expect(issueWorktreeBranch(42, " Fix / checkout ", 2)).toBe("t3code/42-fix-checkout-2");
    expect(issueWorktreeBranch(42, " Fix / checkout ", undefined, "Kaloyanes")).toBe(
      "Kaloyanes/42-fix-checkout",
    );
    expect(issueWorktreeBranch(42, " Fix / checkout ", undefined, "Kaloyanes", "bug")).toBe(
      "bug/42-fix-checkout",
    );
  });

  it("only permits deleting the attached worktree, never the project root", () => {
    expect(
      isSafeIssueWorktreePath({
        projectRoot: "/projects/repo",
        attachedPath: "/worktrees/repo/42-fix",
        requestedPath: "/worktrees/repo/42-fix/",
      }),
    ).toBe(true);
    expect(
      isSafeIssueWorktreePath({
        projectRoot: "/projects/repo",
        attachedPath: "/projects/repo",
        requestedPath: "/projects/repo",
      }),
    ).toBe(false);
    expect(
      isSafeIssueWorktreePath({
        projectRoot: "/projects/repo",
        attachedPath: "/worktrees/repo/42-fix",
        requestedPath: "/tmp/unrelated",
      }),
    ).toBe(false);
  });
});
