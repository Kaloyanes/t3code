import { expect, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { readIssueWorktreeThreads } from "./IssueWorktreeDeletion.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("worktree sibling lookup", (it) => {
  it.effect(
    "includes archived siblings and their active sessions while excluding deleted and other-project threads",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE projection_threads (thread_id TEXT, project_id TEXT, branch TEXT, worktree_path TEXT, archived_at TEXT, deleted_at TEXT)`;
        yield* sql`CREATE TABLE projection_thread_sessions (thread_id TEXT, status TEXT, provider_name TEXT)`;
        yield* sql`INSERT INTO projection_threads VALUES
      ('visible', 'project', 'feature', '/worktree', NULL, NULL),
      ('archived', 'project', 'feature', '/worktree', '2026-09-28', NULL),
      ('deleted', 'project', 'feature', '/worktree', NULL, '2026-09-28'),
      ('other', 'other-project', 'feature', '/worktree', NULL, NULL)`;
        yield* sql`INSERT INTO projection_thread_sessions VALUES ('archived', 'running', 'codex')`;
        const siblings = yield* readIssueWorktreeThreads(ProjectId.make("project"));
        expect(siblings.map((thread) => thread.id)).toEqual(["visible", "archived"]);
        expect(siblings[1]?.session).toEqual({ status: "running", providerName: "codex" });
      }),
  );
});
