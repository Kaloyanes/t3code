import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import Automations from "./ForkSchema/Automations.ts";
import IssueLinks from "./ForkSchema/IssueLinks.ts";
import WorktreePullRequests from "./ForkSchema/WorktreePullRequests.ts";

/**
 * Fork-only tables live outside `effect_sql_migrations`: the migrator skips every
 * id at or below the recorded maximum, so a fork migration under any id would mask
 * the upstream migration that later takes it (see
 * docs/internals/legacy-orchestration-migration.md). Every step here is idempotent
 * and runs after the upstream migrations on each startup.
 */
export const ensureForkSchema = Effect.fn("ensureForkSchema")(function* () {
  yield* IssueLinks;
  yield* WorktreePullRequests;
  yield* Automations;
});

const FORK_MIGRATION_NAMES = new Set([
  "ProjectionIssueLinks",
  "ProjectionProjectWorktreePullRequests",
  "ProjectionAutomations",
  "UsageResumes",
]);

/**
 * Earlier fork builds recorded their own migrations under ids upstream later
 * assigned (52, 54-58). Their schema already covers upstream's 52
 * (`title_state_json`) and 54 (`auto_settle_disabled_at`), so those rows are
 * renamed, and every fork row above 54 is dropped so upstream's migrations at
 * those ids run. Fork tables are recreated by {@link ensureForkSchema}.
 */
export const reconcileForkMigrationLedger = Effect.fn("reconcileForkMigrationLedger")(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const tables = yield* sql`
          SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
        `;
      if (tables.length === 0) return;
      const history = yield* sql<{ readonly migration_id: number; readonly name: string }>`
          SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id >= 52
        `;
      const forkRows = history.filter(
        (row) =>
          FORK_MIGRATION_NAMES.has(row.name) ||
          (row.migration_id > 54 && row.name === "ProjectionThreadsAutoSettleDisabledAt"),
      );
      if (forkRows.length === 0) return;

      const threadColumns = yield* sql<{ readonly name: string }>`
          PRAGMA table_info(projection_threads)
        `;
      const hasColumn = (name: string) => threadColumns.some((column) => column.name === name);
      const upstreamAt = new Map([
        [52, { name: "ProjectionThreadTitleState", column: "title_state_json" }],
        [54, { name: "ProjectionThreadsAutoSettleDisabledAt", column: "auto_settle_disabled_at" }],
      ]);

      for (const row of forkRows) {
        const upstream = upstreamAt.get(row.migration_id);
        if (upstream !== undefined) {
          if (!hasColumn(upstream.column)) {
            yield* sql.unsafe(`ALTER TABLE projection_threads ADD COLUMN ${upstream.column} TEXT`);
          }
          yield* sql`
              UPDATE effect_sql_migrations SET name = ${upstream.name}
              WHERE migration_id = ${row.migration_id}
            `;
        } else if (row.migration_id > 54) {
          yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = ${row.migration_id}`;
        }
      }
      // A fork that renumbered upstream's 54 to 57 never recorded 54 itself.
      const recorded54 = yield* sql`
          SELECT 1 FROM effect_sql_migrations WHERE migration_id = 54
        `;
      if (recorded54.length === 0 && hasColumn("auto_settle_disabled_at")) {
        yield* sql`
            INSERT INTO effect_sql_migrations (migration_id, name)
            VALUES (54, 'ProjectionThreadsAutoSettleDisabledAt')
          `;
      }
    }),
  );
});
