import { describe, expect, it } from "vite-plus/test";
import {
  ProjectId,
  ThreadId,
  type IssueLinkedWork,
  type WorktreePullRequestLink,
} from "@t3tools/contracts";

import { issuesToCompleteOnMerge } from "./IssueCompletionPolicy.ts";

const projectId = ProjectId.make("project");
const worktreePath = "/repo/.t3/worktrees/feature";

const issue = (number: number, path: string | null = worktreePath): IssueLinkedWork => ({
  issue: { provider: "github", host: "github.com", repository: "acme/repo", number },
  threadId: ThreadId.make(`thread-${number}`),
  projectId,
  branch: "feature",
  worktreePath: path,
  linkedAt: "2026-09-19T10:00:00.000Z",
  source: "manual",
});

const pullRequest = (
  number: number,
  state: "open" | "closed" | "merged" | null,
  path: string | null = worktreePath,
): WorktreePullRequestLink => ({
  projectId,
  worktreePath: path,
  host: "github.com",
  repository: "acme/repo",
  number,
  url: `https://github.com/acme/repo/pull/${number}`,
  source: "created",
  linkedAt: "2026-09-19T10:00:00.000Z",
  snapshot:
    state === null
      ? null
      : {
          title: `PR ${number}`,
          state,
          isDraft: false,
          headBranch: "feature",
          baseBranch: "main",
          updatedAt: "2026-09-19T11:00:00.000Z",
          closedAt: state === "closed" ? "2026-09-19T11:00:00.000Z" : null,
          mergedAt: state === "merged" ? "2026-09-19T11:00:00.000Z" : null,
          syncedAt: "2026-09-19T11:00:00.000Z",
        },
  stack: null,
});

describe("issuesToCompleteOnMerge", () => {
  it("returns the single issue when every pull request for its worktree is merged", () => {
    const linkedIssue = issue(42);
    expect(
      issuesToCompleteOnMerge({
        enabled: true,
        issues: [linkedIssue],
        pullRequests: [pullRequest(1, "merged"), pullRequest(2, "merged")],
      }),
    ).toEqual([linkedIssue]);
  });

  it.each(["open", "closed", null] as const)(
    "does not complete the issue when a linked pull request is %s",
    (state) => {
      expect(
        issuesToCompleteOnMerge({
          enabled: true,
          issues: [issue(42)],
          pullRequests: [pullRequest(1, "merged"), pullRequest(2, state)],
        }),
      ).toEqual([]);
    },
  );

  it("does nothing when disabled or when a worktree has multiple linked issues", () => {
    expect(
      issuesToCompleteOnMerge({
        enabled: false,
        issues: [issue(42)],
        pullRequests: [pullRequest(1, "merged")],
      }),
    ).toEqual([]);
    expect(
      issuesToCompleteOnMerge({
        enabled: true,
        issues: [issue(42), issue(43)],
        pullRequests: [pullRequest(1, "merged")],
      }),
    ).toEqual([]);
  });

  it("matches the project checkout through a null worktree path", () => {
    const rootIssue = issue(42, null);
    expect(
      issuesToCompleteOnMerge({
        enabled: true,
        issues: [rootIssue],
        pullRequests: [pullRequest(1, "merged", null)],
      }),
    ).toEqual([rootIssue]);
  });
});
