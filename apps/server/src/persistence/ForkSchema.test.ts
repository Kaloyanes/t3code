import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "./Migrations.ts";

const layer = it.layer(Layer.fresh(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("reconcileForkMigrationLedger", (it) => {
  it.effect("lets upstream migrations run over a fork-numbered ledger", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      // The ledger an earlier fork build left behind: its own names at 52 and 54-57.
      yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id IN (52, 54)`;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name) VALUES
          (52, 'ProjectionIssueLinks'),
          (54, 'ProjectionIssueLinks'),
          (55, 'ProjectionProjectWorktreePullRequests'),
          (56, 'ProjectionAutomations'),
          (57, 'ProjectionThreadsAutoSettleDisabledAt')
      `;

      yield* runMigrations();

      const ledger = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations
        WHERE migration_id >= 52 ORDER BY migration_id
      `;
      assert.deepStrictEqual(
        ledger.map((row) => `${row.migration_id}:${row.name}`),
        [
          "52:ProjectionThreadTitleState",
          "53:PullRequestFilesViewed",
          "54:ProjectionThreadsAutoSettleDisabledAt",
          "55:OrchestrationV2",
          "56:RemoveRedundantProjectionIndexes",
        ],
      );
      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'orchestration_v2_events',
          'projection_issue_links',
          'projection_project_worktree_pull_requests',
          'projection_automations'
        )
        ORDER BY name
      `;
      assert.deepStrictEqual(
        tables.map((row) => row.name),
        [
          "orchestration_v2_events",
          "projection_automations",
          "projection_issue_links",
          "projection_project_worktree_pull_requests",
        ],
      );
    }),
  );
});
