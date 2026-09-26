import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import migrateIssueLinks from "./054_ProjectionIssueLinks.ts";

export default Effect.gen(function* () {
  // Upstream also used migration 54, so either version may already be recorded.
  yield* migrateIssueLinks;
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (!columns.some((column) => column.name === "auto_settle_disabled_at")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN auto_settle_disabled_at TEXT
    `;
  }
});
