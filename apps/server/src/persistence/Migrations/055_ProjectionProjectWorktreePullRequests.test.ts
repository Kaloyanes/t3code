import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.fresh(NodeSqliteClient.layer({ filename: ":memory:" })));

interface WorktreePullRequestRow {
  readonly projectId: string;
  readonly worktreePath: string;
  readonly host: string;
  readonly repository: string;
  readonly number: number;
  readonly url: string;
  readonly source: string;
  readonly linkedAt: string;
  readonly snapshotJson: string | null;
  readonly stackJson: string | null;
}

layer("055_ProjectionProjectWorktreePullRequests", (it) => {
  it.effect("backfills created links and preserves their host state", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });

      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          'project-1', 'Project 1', '/tmp/project-1', '[]',
          '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, worktree_path, created_at, updated_at
        ) VALUES
          (
            'thread-created', 'project-1', 'Created', '{"instanceId":"codex","model":"gpt-5"}',
            '/tmp/worktree', '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'
          ),
          (
            'thread-primary', 'project-1', 'Primary', '{"instanceId":"codex","model":"gpt-5"}',
            NULL, '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'
          ),
          (
            'thread-created-primary', 'project-1', 'Created primary', '{"instanceId":"codex","model":"gpt-5"}',
            NULL, '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'
          )
      `;
      yield* sql`
        INSERT INTO projection_thread_pull_requests (
          thread_id, host, repository, number, url, source, linked_at, snapshot_json, stack_json
        ) VALUES
          (
            'thread-created', 'github.com', 't3tools/t3code', 42,
            'https://github.com/t3tools/t3code/pull/42', 'created',
            '2026-03-01T01:00:00.000Z',
            '{"state":"open","title":"Created","headBranch":"feature","baseBranch":"main","isDraft":false,"updatedAt":"2026-03-01T01:00:00.000Z","syncedAt":"2026-03-01T01:01:00.000Z"}',
            '{"kind":"native","id":"stack-1","number":42,"url":"https://github.com/t3tools/t3code/pull/42","base":"main","layers":[]}'
          ),
          (
            'thread-primary', 'github.com', 't3tools/t3code', 7,
            'https://github.com/t3tools/t3code/pull/7', 'manual',
            '2026-03-01T02:00:00.000Z', NULL, NULL
          ),
          (
            'thread-created-primary', 'github.com', 't3tools/t3code', 8,
            'https://github.com/t3tools/t3code/pull/8', 'created',
            '2026-03-01T03:00:00.000Z', NULL, NULL
          )
      `;

      yield* runMigrations({ toMigrationInclusive: 55 });

      const rows = yield* sql<WorktreePullRequestRow>`
        SELECT
          project_id AS "projectId",
          worktree_path AS "worktreePath",
          host,
          repository,
          number,
          url,
          source,
          linked_at AS "linkedAt",
          snapshot_json AS "snapshotJson",
          stack_json AS "stackJson"
        FROM projection_project_worktree_pull_requests
      `;
      assert.deepStrictEqual(rows, [
        {
          projectId: "project-1",
          worktreePath: "/tmp/worktree",
          host: "github.com",
          repository: "t3tools/t3code",
          number: 42,
          url: "https://github.com/t3tools/t3code/pull/42",
          source: "created",
          linkedAt: "2026-03-01T01:00:00.000Z",
          snapshotJson:
            '{"state":"open","title":"Created","headBranch":"feature","baseBranch":"main","isDraft":false,"updatedAt":"2026-03-01T01:00:00.000Z","syncedAt":"2026-03-01T01:01:00.000Z"}',
          stackJson:
            '{"kind":"native","id":"stack-1","number":42,"url":"https://github.com/t3tools/t3code/pull/42","base":"main","layers":[]}',
        },
        {
          projectId: "project-1",
          worktreePath: "",
          host: "github.com",
          repository: "t3tools/t3code",
          number: 8,
          url: "https://github.com/t3tools/t3code/pull/8",
          source: "created",
          linkedAt: "2026-03-01T03:00:00.000Z",
          snapshotJson: null,
          stackJson: null,
        },
      ]);
      const manualRows = yield* sql<{ readonly source: string }>`
        SELECT source FROM projection_thread_pull_requests WHERE source = 'manual'
      `;
      assert.deepStrictEqual(manualRows, [{ source: "manual" }]);
    }),
  );
});
