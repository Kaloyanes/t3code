import { EnvironmentId, ProjectId, ThreadId, type IssueListEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  collectIssueListFacets,
  groupIssueEntries,
  issueRepositoriesWithCursors,
  mergeIssueListResults,
  issueLinkedWorkForEntry,
  parseIssueQuery,
  planIssueBulkAction,
  sortIssueEntries,
  issueDeletePreflightSummary,
  issueLabelForeground,
  issueWorktreePrimaryAction,
  issueWorktreeIsLinked,
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

describe("issueWorktreeIsLinked", () => {
  const linkedWork = {
    issue: {
      provider: "github" as const,
      host: "github.com",
      repository: "t3tools/t3code",
      number: 42,
    },
    threadId: ThreadId.make("linked-thread"),
    projectId: ProjectId.make("project-1"),
    branch: "feature/issue-42",
    worktreePath: "/worktrees/issue-42/",
    linkedAt: "2026-09-19T00:00:00.000Z",
    source: "created" as const,
  };

  it("recognizes the linked thread and other threads in the same worktree", () => {
    expect(
      issueWorktreeIsLinked({ id: "linked-thread", worktreePath: "/stale/path" }, linkedWork),
    ).toBe(true);
    expect(
      issueWorktreeIsLinked(
        { id: "newer-thread", worktreePath: "/worktrees/issue-42" },
        linkedWork,
      ),
    ).toBe(true);
  });

  it("does not mark a different or detached worktree as linked", () => {
    expect(
      issueWorktreeIsLinked({ id: "other-thread", worktreePath: "/worktrees/other" }, linkedWork),
    ).toBe(false);
    expect(issueWorktreeIsLinked({ id: "other-thread", worktreePath: null }, linkedWork)).toBe(
      false,
    );
  });
});

describe("issueWorktreePrimaryAction", () => {
  it("offers linking when the issue is unlinked and the viewer can link it", () => {
    expect(issueWorktreePrimaryAction({ canLink: true, hasLinkedWork: false })).toBe("link-issue");
  });

  it("keeps new-thread behavior once the issue is linked or linking is unavailable", () => {
    expect(issueWorktreePrimaryAction({ canLink: true, hasLinkedWork: true })).toBe("new-thread");
    expect(issueWorktreePrimaryAction({ canLink: false, hasLinkedWork: false })).toBe("new-thread");
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

function issueEntry(overrides: Partial<IssueListEntry> & { readonly number: number }) {
  return {
    provider: "github" as const,
    host: "github.com",
    projectId: ProjectId.make("project-1"),
    repository: "t3tools/t3code",
    title: `Issue ${overrides.number}`,
    url: `https://github.com/t3tools/t3code/issues/${overrides.number}`,
    author: { login: "octocat", name: null, avatarUrl: null },
    state: "open" as const,
    stateReason: null,
    assignees: [],
    milestone: null,
    labels: [],
    commentsCount: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    closedAt: null,
    environmentId: EnvironmentId.make("env-1"),
    ...overrides,
  };
}

describe("parseIssueQuery", () => {
  it("lifts label, author, assignee and milestone qualifiers out of the text", () => {
    expect(
      parseIssueQuery(
        'crash label:bug,regression -label:wontfix author:octo assignee:me milestone:"v1 beta" on login',
      ),
    ).toEqual({
      text: "crash on login",
      filters: {
        labels: [["bug", "regression"]],
        excludedLabels: ["wontfix"],
        author: "octo",
        assignee: "me",
        milestone: "v1 beta",
      },
    });
  });

  it("reads unknown keys as namespaced labels, the same way the pull request list does", () => {
    expect(parseIssueQuery("area:web size:S,XS").filters.labels).toEqual([
      ["area:web"],
      ["size:S", "size:XS"],
    ]);
  });

  it("leaves GitHub search keys, links, negated people and empty values as text", () => {
    expect(
      parseIssueQuery("is:open no:assignee https://github.com -author:bot label: plain"),
    ).toEqual({
      text: "is:open no:assignee https://github.com -author:bot label: plain",
      filters: {},
    });
  });
});

describe("sortIssueEntries", () => {
  const entries = [
    issueEntry({
      number: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
      commentsCount: 5,
    }),
    issueEntry({
      number: 2,
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
      commentsCount: 9,
    }),
    issueEntry({
      number: 3,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      commentsCount: 1,
    }),
  ];
  const order = (sort: Parameters<typeof sortIssueEntries>[1]) =>
    sortIssueEntries(entries, sort).map((entry) => entry.number);

  it("merges answers in the order the reader chose", () => {
    expect(order("updated")).toEqual([1, 2, 3]);
    expect(order("created-desc")).toEqual([3, 2, 1]);
    expect(order("created-asc")).toEqual([1, 2, 3]);
    expect(order("comments")).toEqual([2, 1, 3]);
  });
});

describe("groupIssueEntries", () => {
  const working = issueEntry({
    number: 1,
    linkedWork: { threadId: ThreadId.make("t"), branch: "b", worktreePath: null, source: "manual" },
  });
  const mine = issueEntry({ number: 2, assignees: [{ login: "Me", name: null, avatarUrl: null }] });
  const other = issueEntry({ number: 3 });

  it("shelves linked work, then the viewer's assignments, then the rest, keeping order", () => {
    expect(
      groupIssueEntries([other, mine, working], "all", "me").map((group) => [
        group.key,
        group.entries.map((entry) => entry.number),
      ]),
    ).toEqual([
      ["working", [1]],
      ["assigned", [2]],
      ["others", [3]],
    ]);
  });

  it("does not group a narrowed involvement, and needs a viewer to know what is theirs", () => {
    expect(groupIssueEntries([other, mine], "assigned", "me")).toEqual([
      { key: "others", label: "", entries: [other, mine] },
    ]);
    expect(groupIssueEntries([mine], "all", null).map((group) => group.key)).toEqual(["others"]);
  });
});

describe("collectIssueListFacets", () => {
  it("counts people, labels and milestones across rows once each", () => {
    const facets = collectIssueListFacets([
      issueEntry({
        number: 1,
        labels: [{ name: "bug", color: "d73a4a" }],
        assignees: [{ login: "a", name: null, avatarUrl: null }],
        milestone: { number: 1, title: "v1", state: "open", dueOn: null },
      }),
      issueEntry({ number: 2, labels: [{ name: "Bug", color: null }] }),
      issueEntry({ number: 2, labels: [{ name: "bug", color: null }] }),
    ]);
    expect(facets.labels).toEqual([{ name: "bug", color: "d73a4a", count: 2 }]);
    expect(facets.authors.map((facet) => [facet.actor.login, facet.count])).toEqual([
      ["octocat", 2],
    ]);
    expect(facets.assignees.map((facet) => facet.actor.login)).toEqual(["a"]);
    expect(facets.milestones).toEqual([{ title: "v1", count: 1 }]);
  });
});

describe("planIssueBulkAction", () => {
  const open = issueEntry({ number: 1, labels: [{ name: "bug", color: null }] });
  const closed = issueEntry({ number: 2, state: "closed", stateReason: "completed" });

  it("only sends requests that change something", () => {
    expect(
      planIssueBulkAction([open, closed], { kind: "close", reason: "not-planned" }).map((step) => [
        step.command,
        step.entry.number,
        step.input,
      ]),
    ).toEqual([
      [
        "close",
        1,
        {
          projectId: open.projectId,
          host: "github.com",
          repository: "t3tools/t3code",
          number: 1,
          reason: "not-planned",
        },
      ],
    ]);
    expect(
      planIssueBulkAction([open, closed], { kind: "reopen" }).map((step) => step.entry.number),
    ).toEqual([2]);
  });

  it("sends the whole label and assignee sets, skipping rows that already have the name", () => {
    const labelSteps = planIssueBulkAction([open, closed], { kind: "add-label", label: "BUG" });
    expect(labelSteps.map((step) => step.entry.number)).toEqual([2]);
    expect(planIssueBulkAction([open], { kind: "add-label", label: "ui" })[0]?.input).toMatchObject(
      {
        labels: ["bug", "ui"],
      },
    );
    expect(planIssueBulkAction([open], { kind: "assign", login: "me" })[0]?.input).toMatchObject({
      assignees: ["me"],
    });
  });
});

describe("issueLinkedWorkForEntry", () => {
  it("rebuilds the dialog's linked-work record from a row summary", () => {
    expect(issueLinkedWorkForEntry(issueEntry({ number: 1 }))).toBeNull();
    expect(
      issueLinkedWorkForEntry(
        issueEntry({
          number: 7,
          linkedWork: {
            threadId: ThreadId.make("thread-7"),
            branch: "fix/7",
            worktreePath: "/w/7",
            source: "created",
          },
        }),
      ),
    ).toMatchObject({
      issue: { provider: "github", host: "github.com", repository: "t3tools/t3code", number: 7 },
      threadId: "thread-7",
      branch: "fix/7",
      worktreePath: "/w/7",
      source: "created",
    });
  });
});

describe("mergeIssueListResults", () => {
  const result = (
    entries: ReadonlyArray<IssueListEntry>,
    nextCursors: Record<string, string> = {},
  ) => ({
    providers: [],
    entries,
    errors: [],
    truncated: Object.keys(nextCursors).length > 0,
    nextCursors,
  });
  const { environmentId: _environmentId, ...plain } = issueEntry({ number: 1 });
  const row = (number: number, updatedAt: string, comments = 0): IssueListEntry => ({
    ...plain,
    number,
    updatedAt,
    commentsCount: comments,
  });
  const envA = EnvironmentId.make("env-a");
  const envB = EnvironmentId.make("env-b");

  it("tags rows with their server, keeps a re-read row once, and honors the sort", () => {
    const merged = mergeIssueListResults(
      [
        [
          envA,
          result([row(1, "2026-01-01T00:00:00.000Z", 3), row(2, "2026-03-01T00:00:00.000Z", 1)]),
        ],
        [envA, result([row(1, "2026-01-01T00:00:00.000Z", 3)])],
        [envB, result([row(1, "2026-02-01T00:00:00.000Z", 9)])],
      ],
      "comments",
    );
    expect(merged.entries.map((entry) => [entry.environmentId, entry.number])).toEqual([
      [envB, 1],
      [envA, 1],
      [envA, 2],
    ]);
  });

  it("takes each server's paging state from its latest answer", () => {
    const merged = mergeIssueListResults(
      [
        [envA, result([], { "p:github.com:o/r": "c1" })],
        [envB, result([], { "p:github.com:o/s": "c2" })],
        [envA, result([])],
      ],
      undefined,
    );
    expect([...merged.nextCursorsByEnvironment.keys()]).toEqual([envB]);
    expect(merged.truncatedEnvironments).toEqual([envB]);
  });
});

describe("issueRepositoriesWithCursors", () => {
  const web = { projectId: ProjectId.make("p1"), host: "github.com", repository: "T3/Web" };
  const api = { projectId: ProjectId.make("p2"), host: "github.com", repository: "t3/api" };

  it("narrows a continuation to the repositories with pages left, whatever host the key names", () => {
    expect(issueRepositoriesWithCursors([web, api], { "p1:ghe.local:t3/web": "x" })).toEqual([web]);
  });

  it("asks every repository again when no cursor matches", () => {
    expect(issueRepositoriesWithCursors([web, api], { "p9:github.com:x/y": "x" })).toEqual([
      web,
      api,
    ]);
  });
});
