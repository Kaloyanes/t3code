import { ProjectId, type IssueTimelineEvent } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  groupIssueTimelineEvents,
  issueCandidatesInput,
  issueSubIssueProgress,
  issueNameChanges,
  toggleIssueName,
} from "./issueDetail.logic";

const alice = { login: "alice", name: null, avatarUrl: null };
const bob = { login: "bob", name: null, avatarUrl: null };

function labeled(
  id: string,
  name: string,
  createdAt: string,
  actor = alice,
  tag: "labeled" | "unlabeled" = "labeled",
): IssueTimelineEvent {
  return { _tag: tag, id, actor, createdAt, label: { name, color: null } };
}

describe("issueSubIssueProgress", () => {
  it("prefers the host's count over a possibly partial list", () => {
    expect(
      issueSubIssueProgress({ total: 5, completed: 3, percentCompleted: 60 }, [
        { state: "closed" },
      ]),
    ).toEqual({ total: 5, completed: 3, percent: 60, label: "3 of 5 done" });
  });

  it("counts the list when the host sent no summary", () => {
    expect(
      issueSubIssueProgress(undefined, [{ state: "closed" }, { state: "open" }, { state: "open" }]),
    ).toEqual({ total: 3, completed: 1, percent: 33, label: "1 of 3 done" });
  });

  it("has nothing to say without sub-issues", () => {
    expect(issueSubIssueProgress({ total: 0, completed: 0, percentCompleted: 0 }, [])).toBeNull();
    expect(issueSubIssueProgress(undefined, undefined)).toBeNull();
  });
});

describe("issueNameChanges", () => {
  it("names only what was added and removed, ignoring case", () => {
    expect(issueNameChanges(["bug", "docs"], ["Bug", "ui"])).toEqual({
      added: ["ui"],
      removed: ["docs"],
    });
    expect(issueNameChanges(["a"], ["A"])).toEqual({ added: [], removed: [] });
  });
});

describe("toggleIssueName", () => {
  it("adds once and removes regardless of case", () => {
    expect(toggleIssueName(["bug"], "Bug", true)).toEqual(["Bug"]);
    expect(toggleIssueName(["bug", "docs"], "BUG", false)).toEqual(["docs"]);
  });
});

describe("issueCandidatesInput", () => {
  it("keys the same read whatever order the selection was built in", () => {
    const projectId = ProjectId.make("project");
    expect(
      JSON.stringify(
        issueCandidatesInput({ repository: "a/b", host: "github.com", projectId }, "labels"),
      ),
    ).toBe(
      JSON.stringify(
        issueCandidatesInput({ projectId, host: "github.com", repository: "a/b" }, "labels"),
      ),
    );
  });
});

describe("groupIssueTimelineEvents", () => {
  it("collapses one person's run of label edits into one row", () => {
    const rows = groupIssueTimelineEvents([
      labeled("1", "bug", "2026-09-01T00:00:00Z"),
      labeled("2", "triage", "2026-09-01T00:01:00Z", alice, "unlabeled"),
      labeled("3", "docs", "2026-09-01T00:02:00Z"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "labels",
      id: "1",
      added: [{ name: "bug" }, { name: "docs" }],
      removed: [{ name: "triage" }],
    });
  });

  it("drops a label added and taken back within the run", () => {
    const rows = groupIssueTimelineEvents([
      labeled("1", "bug", "2026-09-01T00:00:00Z"),
      labeled("2", "bug", "2026-09-01T00:00:30Z", alice, "unlabeled"),
    ]);
    expect(rows).toEqual([]);
  });

  it("splits on another person, a gap, or another kind of event", () => {
    const comment: IssueTimelineEvent = {
      _tag: "comment",
      id: "c",
      actor: alice,
      createdAt: "2026-09-01T00:03:00Z",
      comment: {
        id: "c",
        author: alice,
        body: "hi",
        createdAt: "2026-09-01T00:03:00Z",
        url: null,
      },
    };
    const rows = groupIssueTimelineEvents([
      labeled("1", "bug", "2026-09-01T00:00:00Z"),
      labeled("2", "docs", "2026-09-01T00:01:00Z", bob),
      comment,
      labeled("3", "ui", "2026-09-01T00:04:00Z", bob),
      labeled("4", "ux", "2026-09-01T01:00:00Z", bob),
    ]);
    expect(rows.map((row) => (row.kind === "event" ? row.event._tag : row.id))).toEqual([
      "1",
      "2",
      "comment",
      "3",
      "4",
    ]);
  });

  it("groups assignments separately from labels", () => {
    const rows = groupIssueTimelineEvents([
      {
        _tag: "assigned",
        id: "a1",
        actor: alice,
        createdAt: "2026-09-01T00:00:00Z",
        assignee: bob,
      },
      labeled("l1", "bug", "2026-09-01T00:00:10Z"),
    ]);
    expect(rows.map((row) => row.kind)).toEqual(["assignees", "labels"]);
    expect(rows[0]).toMatchObject({ added: [{ login: "bob" }], removed: [] });
  });
});
