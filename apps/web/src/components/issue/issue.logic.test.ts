import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  issueDeletePreflightSummary,
  issueLabelForeground,
  normalizeIssueLabelColor,
  selectIssueWorktreeAction,
} from "./issue.logic";

function contrastRatio(background: string, foreground: string) {
  const luminance = (color: string) =>
    [1, 3, 5]
      .map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255)
      .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
  const values = [luminance(background), luminance(foreground)].toSorted((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe("issue label colors", () => {
  it("normalizes six-digit GitHub colors and rejects invalid values", () => {
    expect(normalizeIssueLabelColor("#ABC123")).toBe("#abc123");
    expect(normalizeIssueLabelColor("abc123")).toBe("#abc123");
    expect(normalizeIssueLabelColor("abc")).toBeNull();
    expect(normalizeIssueLabelColor("not-a-color")).toBeNull();
  });

  it.each(["#b60205", "#0e8a16", "#fbca04", "#d4c5f9"])(
    "selects readable text for %s",
    (background) => {
      const foreground = issueLabelForeground(background);
      expect(contrastRatio(background, foreground)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

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
