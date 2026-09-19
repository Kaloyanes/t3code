import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.fresh(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("056_ProjectionAutomations", (it) => {
  it.effect("creates durable automation and run projections", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 55 });
      yield* runMigrations({ toMigrationInclusive: 56 });

      const automationColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_automations)
      `;
      const runColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_automation_runs)
      `;

      assert.deepStrictEqual(
        automationColumns.map(({ name }) => name),
        [
          "automation_id",
          "project_id",
          "name",
          "prompt",
          "schedule_json",
          "execution_json",
          "status",
          "next_run_at",
          "last_run_id",
          "created_at",
          "updated_at",
        ],
      );
      assert.deepStrictEqual(
        runColumns.map(({ name }) => name),
        [
          "run_id",
          "automation_id",
          "project_id",
          "thread_id",
          "trigger",
          "prompt",
          "execution_json",
          "scheduled_at",
          "status",
          "started_at",
          "completed_at",
          "late_by_ms",
          "reason",
          "worktree_path",
        ],
      );

      yield* sql`
        INSERT INTO projection_automations (
          automation_id, project_id, name, prompt, schedule_json, execution_json,
          status, next_run_at, last_run_id, created_at, updated_at
        ) VALUES (
          'automation-1', 'project-1', 'Health check', 'Run tests',
          '{"kind":"daily","time":"09:30","timeZone":"UTC"}',
          '{"modelSelection":{"instanceId":"codex","model":"gpt-5"},"baseBranch":"main"}',
          'active', '2026-09-21T09:30:00.000Z', NULL,
          '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT INTO projection_automation_runs (
          run_id, automation_id, project_id, thread_id, trigger, prompt,
          execution_json, scheduled_at, status, started_at, completed_at,
          late_by_ms, reason, worktree_path
        ) VALUES (
          'run-1', 'automation-1', 'project-1', NULL, 'schedule', 'Run tests',
          '{"modelSelection":{"instanceId":"codex","model":"gpt-5"},"baseBranch":"main"}',
          '2026-09-20T09:30:00.000Z', 'scheduled', NULL, NULL, 0, NULL,
          '/tmp/worktree'
        )
      `;

      const rows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM projection_automation_runs WHERE automation_id = 'automation-1'
      `;
      assert.deepStrictEqual(rows, [{ count: 1 }]);
    }),
  );
});
