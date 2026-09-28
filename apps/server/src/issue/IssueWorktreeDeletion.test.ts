import { describe, expect, it } from "@effect/vitest";
import {
  IssueOperationError,
  ProjectId,
  ThreadId,
  type IssueWorktreeDeletePreflightItem,
  type IssueWorktreeDeleteInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { deleteIssueWorktree, resolveIssueWorktreeAttachment } from "./IssueWorktreeDeletion.ts";

const projectId = ProjectId.make("project");
const selection = { projectId, threadId: ThreadId.make("thread"), path: "/worktree" };
const issue = {
  projectId,
  host: "github.com",
  repository: "owner/repo",
  number: 42,
  state: "open" as const,
};
const preflight: IssueWorktreeDeletePreflightItem = {
  ...selection,
  branch: "feature",
  activeAgent: null,
  blocked: false,
  changedFiles: [],
  unpushedCommitCount: 0,
  canDelete: true,
  requiresForce: false,
  reason: null,
  issues: [issue],
};
const detachedWorkspace = {
  ...selection,
  branch: "feature",
  worktreePath: selection.path,
  detachedAt: "2026-09-28T00:00:00.000Z",
};

function setup(
  options: {
    blocked?: boolean;
    changed?: boolean;
    unpushed?: boolean;
    detachFails?: boolean;
    restoreFails?: boolean;
    closeFails?: boolean;
    unknown?: boolean;
    removeFails?: boolean;
    state?: "open" | "closed";
    issues?: IssueWorktreeDeletePreflightItem["issues"];
    input?: Partial<IssueWorktreeDeleteInput>;
  } = {},
) {
  const calls: string[] = [];
  const command = deleteIssueWorktree(
    {
      selections: [selection],
      forceAcknowledged: false,
      issueDecisions: [{ ...issue, action: "completed" }],
      ...options.input,
    },
    selection,
    {
      preflight: () =>
        Effect.succeed({
          ...preflight,
          issues: options.issues ?? preflight.issues,
          blocked: options.blocked ?? false,
          requiresForce: options.changed === true || options.unpushed === true,
          unpushedCommitCount: options.unpushed ? 3 : 0,
          changedFiles: options.changed ? ["dirty.ts"] : [],
          reason: options.blocked ? "Agent running" : null,
        }),
      close: (input) =>
        Effect.gen(function* () {
          calls.push(`close:${input.reason}`);
          if (options.closeFails)
            return yield* Effect.fail(
              new IssueOperationError({ operation: "close", detail: "failed" }),
            );
        }),
      state: () =>
        options.unknown
          ? Effect.fail(new IssueOperationError({ operation: "detail", detail: "failed" }))
          : Effect.succeed(options.state ?? "open"),
      detach: () =>
        Effect.gen(function* () {
          calls.push("detach");
          if (options.detachFails)
            return yield* new IssueOperationError({ operation: "detach", detail: "failed" });
          return {
            detachedWorkspace,
            restore: Effect.gen(function* () {
              calls.push("restore");
              if (options.restoreFails)
                return yield* new IssueOperationError({ operation: "restore", detail: "failed" });
            }),
          };
        }),
      remove: () =>
        Effect.gen(function* () {
          calls.push("remove");
          if (options.removeFails)
            return yield* Effect.fail(
              new IssueOperationError({ operation: "remove", detail: "failed" }),
            );
        }),
    },
  );
  return { calls, command };
}

describe("issue worktree deletion", () => {
  it.effect(
    "removes the worktree after a failed close and reports that the issue remains open",
    () =>
      Effect.gen(function* () {
        const { calls, command } = setup({ closeFails: true });
        const result = yield* command;
        expect(result.deleted).toBe(true);
        expect(calls).toEqual(["close:completed", "detach", "remove"]);
        expect(result.warnings).toEqual(["owner/repo#42 remains open. Closing failed."]);
      }),
  );
  it.effect("reports an unknown close outcome without claiming the issue remains open", () =>
    Effect.gen(function* () {
      const { command } = setup({ closeFails: true, unknown: true });
      const result = yield* command;
      expect(result.deleted).toBe(true);
      expect(result.warnings).toEqual([
        "owner/repo#42: closing could not be confirmed. Check the issue's status.",
      ]);
    }),
  );
  it.effect(
    "restores workspace associations and reports successful closes after Git removal fails",
    () =>
      Effect.gen(function* () {
        const { calls, command } = setup({ removeFails: true });
        const result = yield* command;
        expect(result.deleted).toBe(false);
        expect(calls).toEqual(["close:completed", "detach", "remove", "restore"]);
        expect(result.error).toContain("associations were restored");
        expect(result.warnings).toEqual(["owner/repo#42 closed as completed."]);
      }),
  );
  it.effect("blocks an active sibling before any issue close or workspace mutation", () =>
    Effect.gen(function* () {
      const { calls, command } = setup({ blocked: true });
      expect((yield* command).deleted).toBe(false);
      expect(calls).toEqual([]);
    }),
  );
  it.effect("blocks local changes before closing issues even when retaining unpushed commits", () =>
    Effect.gen(function* () {
      const { calls, command } = setup({ changed: true, input: { preserveUnpushedCommits: true } });
      expect((yield* command).deleted).toBe(false);
      expect(calls).toEqual([]);
    }),
  );
  it.effect("keeps issues open by default", () =>
    Effect.gen(function* () {
      const { calls, command } = setup({ input: { issueDecisions: [] } });
      expect((yield* command).deleted).toBe(true);
      expect(calls).toEqual(["detach", "remove"]);
    }),
  );
  it.effect("does not close a previously closed issue again", () =>
    Effect.gen(function* () {
      const { calls, command } = setup({ issues: [{ ...issue, state: "closed" }] });
      expect((yield* command).deleted).toBe(true);
      expect(calls).toEqual(["detach", "remove"]);
    }),
  );
  it.effect("supports not-planned and continues to remaining issues after close failures", () =>
    Effect.gen(function* () {
      const second = { ...issue, number: 43 };
      const { calls, command } = setup({
        closeFails: true,
        issues: [issue, second],
        input: {
          issueDecisions: [
            { ...issue, action: "not-planned" },
            { ...second, action: "completed" },
          ],
        },
      });
      const result = yield* command;
      expect(result.deleted).toBe(true);
      expect(calls).toEqual(["close:not-planned", "close:completed", "detach", "remove"]);
      expect(result.warnings).toHaveLength(2);
    }),
  );
  it.effect("leaves unknown issues unchanged unless a close was explicitly selected", () =>
    Effect.gen(function* () {
      const { calls, command } = setup({
        issues: [{ ...issue, state: null }],
        input: { issueDecisions: [] },
      });
      expect((yield* command).deleted).toBe(true);
      expect(calls).toEqual(["detach", "remove"]);
    }),
  );
});

describe("worktree deletion safety and partial failures", () => {
  it.effect("retains unpushed commits without force when explicitly requested", () =>
    Effect.gen(function* () {
      const { calls, command } = setup({
        unpushed: true,
        input: { preserveUnpushedCommits: true },
      });
      expect((yield* command).deleted).toBe(true);
      expect(calls).toEqual(["close:completed", "detach", "remove"]);
    }),
  );
  it.effect("keeps the issue-panel force requirement for unpushed commits", () =>
    Effect.gen(function* () {
      const { calls, command } = setup({ unpushed: true });
      expect((yield* command).deleted).toBe(false);
      expect(calls).toEqual([]);
    }),
  );
  it.effect("does not remove a worktree when detaching fails and reports the completed close", () =>
    Effect.gen(function* () {
      const { calls, command } = setup({ detachFails: true });
      const result = yield* command;
      expect(result.deleted).toBe(false);
      expect(calls).toEqual(["close:completed", "detach"]);
      expect(result.warnings).toEqual(["owner/repo#42 closed as completed."]);
    }),
  );
  it.effect("reports restore failures without claiming associations were restored", () =>
    Effect.gen(function* () {
      const { calls, command } = setup({ removeFails: true, restoreFails: true });
      const result = yield* command;
      expect(result.deleted).toBe(false);
      expect(calls).toEqual(["close:completed", "detach", "remove", "restore"]);
      expect(result.error).toContain("could not be restored");
    }),
  );
});

describe("worktree attachment resolution", () => {
  const link = { projectId, branch: "feature", worktreePath: "/worktrees/feature" };
  it("uses a preserved issue workspace after its thread is deleted", () => {
    expect(resolveIssueWorktreeAttachment(projectId, undefined, link)).toEqual(link);
  });
  it("does not use a stale issue workspace when the live thread moved", () => {
    expect(
      resolveIssueWorktreeAttachment(projectId, { ...link, worktreePath: null }, link),
    ).toBeNull();
  });
  it("rejects links belonging to another project", () => {
    expect(resolveIssueWorktreeAttachment(ProjectId.make("other"), undefined, link)).toBeNull();
  });
});
