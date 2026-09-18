import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { issueDeletePreflightSummary, selectIssueWorktreeAction } from "./issue.logic";

describe("selectIssueWorktreeAction", () => {
  it("opens linked work before offering replacement or creation", () => {
    expect(
      selectIssueWorktreeAction({
        linkedWork: { threadId: "thread-1", worktreePath: "/tmp/worktree" },
        detachedWorkspacePath: "/tmp/old-worktree",
      }),
    ).toBe("open-linked");
  });

  it("offers replacement for detached work and creation otherwise", () => {
    expect(selectIssueWorktreeAction({ linkedWork: null, detachedWorkspacePath: "/tmp/old" })).toBe(
      "replace",
    );
    expect(selectIssueWorktreeAction({ linkedWork: null })).toBe("create");
  });
});

describe("issueDeletePreflightSummary", () => {
  it("separates blocked worktrees from deletable work requiring force", () => {
    const base = {
      threadId: ThreadId.make("thread-1"),
      projectId: ProjectId.make("project-1"),
      path: "/tmp/worktree",
      branch: "t3code/12-fix-login",
      activeAgent: null,
      changedFiles: [] as readonly string[],
      unpushedCommitCount: 0,
      reason: null,
    };
    expect(
      issueDeletePreflightSummary([
        { ...base, blocked: false, canDelete: true, requiresForce: false },
        {
          ...base,
          threadId: ThreadId.make("thread-2"),
          path: "/tmp/dirty",
          blocked: false,
          canDelete: true,
          requiresForce: true,
          changedFiles: ["src/login.ts"],
        },
        {
          ...base,
          threadId: ThreadId.make("thread-3"),
          path: "/tmp/running",
          activeAgent: "codex",
          blocked: true,
          canDelete: false,
          requiresForce: false,
          reason: "Agent is running",
        },
      ]),
    ).toEqual({ deletable: 2, blocked: 1, forceRequired: 1 });
  });
});
