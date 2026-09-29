import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS usage_resumes (
      thread_id TEXT PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      prompt TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      execution_json TEXT NOT NULL,
      baseline_message_at TEXT,
      auth_identity TEXT NOT NULL,
      probe_failures INTEGER NOT NULL DEFAULT 0
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS usage_resumes_due ON usage_resumes(status, scheduled_at)`;
});
