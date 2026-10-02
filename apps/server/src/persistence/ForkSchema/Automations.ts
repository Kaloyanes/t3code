import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_automations (
      automation_id TEXT NOT NULL PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_json TEXT NOT NULL,
      execution_json TEXT NOT NULL,
      status TEXT NOT NULL,
      next_run_at TEXT,
      last_run_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_automations_due
    ON projection_automations(status, next_run_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_automation_runs (
      run_id TEXT NOT NULL PRIMARY KEY,
      automation_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      thread_id TEXT,
      trigger TEXT NOT NULL,
      prompt TEXT NOT NULL,
      execution_json TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      late_by_ms INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      worktree_path TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_automation_runs_automation
    ON projection_automation_runs(automation_id, scheduled_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_automation_runs_thread
    ON projection_automation_runs(thread_id)
  `;
});
