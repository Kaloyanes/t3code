import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";

import {
  isSafeIssueWorktreePath,
  issueWorktreeBranch,
  issueWorktreeFragment,
  normalizeIssue,
  issueFilterSearchTerms,
  issueSortOrder,
  compareIssueListEntries,
  issueListEntry,
  normalizeLinkedPullRequests,
  normalizeIssueTimelineEvents,
} from "./IssueService.ts";
import { IssueListEntry, IssueTimelineEvent, ProjectId, ThreadId } from "@t3tools/contracts";

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

  it.each([
    ["Fix checkout redirect", "142-fix-checkout-redirect"],
    ["Fix: checkout / login's redirect!", "142-fix-checkout-logins-redirect"],
    ["x".repeat(200), `142-${"x".repeat(60)}`],
    ["修复登录", "142"],
  ])("builds an issue branch from the title %s", (title, fragment) => {
    expect(issueWorktreeFragment(142, title)).toBe(fragment);
    expect(issueWorktreeBranch(142, title, undefined, "Kaloyanes")).toBe(`Kaloyanes/${fragment}`);
    expect(issueWorktreeBranch(142, title, 2, "Kaloyanes")).toBe(`Kaloyanes/${fragment}-2`);
    expect(issueWorktreeBranch(142, title, undefined, "Kaloyanes", "bug")).toBe(`bug/${fragment}`);
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

const context = {
  projectId: ProjectId.make("project-1"),
  host: "github.com",
  repository: "owner/repo",
};
const createdAt = "2026-01-01T00:00:00.000Z";
const pr = {
  __typename: "PullRequest",
  number: 7,
  title: "Fix checkout",
  url: "https://github.com/owner/repo/pull/7",
  state: "MERGED",
  isDraft: false,
  repository: { nameWithOwner: "owner/repo" },
};

describe("IssueService list queries", () => {
  it("translates OR groups, exclusions and safely quoted values before host paging", () => {
    expect(
      issueFilterSearchTerms({
        labels: [["bug", 'good "first" issue'], ["web\\ui"]],
        excludedLabels: ["wont fix", 'bad"label'],
        author: "octocat",
        assignee: "hubot",
        milestone: 'Release "1"',
      }),
    ).toEqual([
      'label:"bug","good first issue"',
      'label:"webui"',
      '-label:"wont fix"',
      '-label:"badlabel"',
      'author:"octocat"',
      'assignee:"hubot"',
      'milestone:"Release 1"',
    ]);
    expect(issueFilterSearchTerms(undefined)).toEqual([]);
  });

  it.each([
    ["updated", "updated-desc", "UPDATED_AT", "DESC"],
    ["created-desc", "created-desc", "CREATED_AT", "DESC"],
    ["created-asc", "created-asc", "CREATED_AT", "ASC"],
    ["comments", "comments-desc", "COMMENTS", "DESC"],
  ] as const)("maps %s to both host sort representations", (sort, search, field, direction) => {
    expect(issueSortOrder(sort)).toEqual({ search, orderBy: { field, direction } });
  });

  it("defaults to updated order and respects the selected in-memory order", () => {
    expect(issueSortOrder()).toEqual(issueSortOrder("updated"));
    const older = normalizeIssue(
      { number: 1, createdAt, updatedAt: "2026-01-03T00:00:00.000Z", comments: { totalCount: 9 } },
      context,
    )!;
    const newer = normalizeIssue(
      {
        number: 2,
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: createdAt,
        comments: { totalCount: 1 },
      },
      context,
    )!;
    expect(compareIssueListEntries(older, newer)).toBeLessThan(0);
    expect(compareIssueListEntries(older, newer, "created-desc")).toBeGreaterThan(0);
    expect(compareIssueListEntries(older, newer, "created-asc")).toBeLessThan(0);
    expect(compareIssueListEntries(older, newer, "comments")).toBeLessThan(0);
  });

  it("carries rich row fields through wire encoding without body or reactions", () => {
    const issue = normalizeIssue(
      {
        number: 42,
        title: "Fix checkout",
        body: "Detail only",
        createdAt,
        updatedAt: createdAt,
        state: "CLOSED",
        stateReason: "NOT_PLANNED",
        assignees: { nodes: [{ login: "octocat", name: "Octocat", avatarUrl: null }] },
        milestone: { number: 3, title: "Release", state: "OPEN", dueOn: null },
      },
      context,
    )!;
    const linkedWork = {
      threadId: ThreadId.make("thread-1"),
      branch: "fix/42",
      worktreePath: "/tmp/worktree",
      source: "manual" as const,
    };
    const entry = issueListEntry(issue, linkedWork);
    const encoded = Schema.encodeSync(IssueListEntry)(entry);
    expect(encoded.assignees).toEqual(issue.assignees);
    expect(encoded.milestone).toEqual(issue.milestone);
    expect(encoded.stateReason).toBe("not-planned");
    expect(encoded.linkedWork).toEqual(linkedWork);
    expect(entry).not.toHaveProperty("body");
    expect(entry).not.toHaveProperty("reactions");
    expect(issueListEntry(issue, null).linkedWork).toBeNull();
  });
});

describe("IssueService related work and timeline", () => {
  it("deduplicates closing, cross-referenced and connected PRs by URL", () => {
    expect(
      normalizeLinkedPullRequests({
        closedByPullRequestsReferences: { nodes: [pr] },
        timelineItems: {
          nodes: [{ source: pr }, { subject: pr }, { source: { ...pr, __typename: "Issue" } }],
        },
      }),
    ).toEqual([
      {
        number: 7,
        title: pr.title,
        url: pr.url,
        state: "merged",
        repository: "owner/repo",
        isDraft: false,
      },
    ]);
  });

  it.each([
    [
      { __typename: "LabeledEvent", label: { name: "bug", color: "b60205" } },
      { _tag: "labeled", label: { name: "bug", color: "b60205" } },
    ],
    [
      { __typename: "UnlabeledEvent", label: { name: "bug", color: null } },
      { _tag: "unlabeled", label: { name: "bug", color: null } },
    ],
    [
      { __typename: "AssignedEvent", assignee: { login: "octocat" } },
      { _tag: "assigned", assignee: { login: "octocat", name: null, avatarUrl: null } },
    ],
    [
      { __typename: "UnassignedEvent", assignee: null },
      { _tag: "unassigned", assignee: null },
    ],
    [
      { __typename: "ClosedEvent", stateReason: "COMPLETED" },
      { _tag: "closed", stateReason: "completed" },
    ],
    [{ __typename: "ReopenedEvent" }, { _tag: "reopened" }],
    [
      { __typename: "RenamedTitleEvent", previousTitle: "Before", currentTitle: "After" },
      { _tag: "renamed", from: "Before", to: "After" },
    ],
    [
      { __typename: "MilestonedEvent", milestoneTitle: "Release" },
      { _tag: "milestoned", title: "Release" },
    ],
    [
      { __typename: "DemilestonedEvent", milestoneTitle: "Release" },
      { _tag: "demilestoned", title: "Release" },
    ],
  ])("normalizes $0.__typename with its actor and timestamp", (raw, expected) => {
    const event = normalizeIssueTimelineEvents({
      ...raw,
      id: "event-1",
      actor: { login: "hubot" },
      createdAt,
    })[0]!;
    expect(Schema.decodeSync(IssueTimelineEvent)(event)).toMatchObject({
      ...expected,
      id: "event-1",
      actor: { login: "hubot", name: null, avatarUrl: null },
      createdAt,
    });
  });

  it("normalizes issue and PR references, connected PRs, and interleaved comments", () => {
    const base = { id: "event-1", createdAt, actor: null };
    expect(
      normalizeIssueTimelineEvents({ ...base, __typename: "CrossReferencedEvent", source: pr })[0],
    ).toMatchObject({
      _tag: "cross-referenced",
      source: { kind: "pull-request", number: 7, state: "merged" },
    });
    expect(
      normalizeIssueTimelineEvents({
        ...base,
        __typename: "CrossReferencedEvent",
        source: { ...pr, __typename: "Issue", state: "OPEN" },
      })[0],
    ).toMatchObject({ _tag: "cross-referenced", source: { kind: "issue", state: "open" } });
    expect(
      normalizeIssueTimelineEvents({ ...base, __typename: "ConnectedEvent", subject: pr })[0],
    ).toMatchObject({ _tag: "connected", pullRequest: { number: 7, state: "merged" } });
    const comment = normalizeIssueTimelineEvents({
      ...base,
      __typename: "IssueComment",
      author: { login: "octocat" },
      body: "Hello",
      url: null,
    })[0]!;
    expect(Schema.decodeSync(IssueTimelineEvent)(comment)).toMatchObject({
      _tag: "comment",
      actor: { login: "octocat" },
      comment: { id: "event-1", body: "Hello", createdAt },
    });
    expect(
      normalizeIssueTimelineEvents({
        ...base,
        __typename: "ReferencedEvent",
        commit: {
          associatedPullRequests: {
            nodes: [pr, { ...pr, number: 8, url: "https://github.com/owner/repo/pull/8" }],
          },
        },
      }),
    ).toHaveLength(2);
    expect(
      normalizeIssueTimelineEvents({ ...base, __typename: "ReferencedEvent", commit: null }),
    ).toEqual([]);
    expect(normalizeIssueTimelineEvents({ ...base, __typename: "UnknownEvent" })).toEqual([]);
    expect(normalizeIssueTimelineEvents({ __typename: "ReopenedEvent" })).toEqual([]);
  });
});
