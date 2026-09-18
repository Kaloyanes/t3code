import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!columns.some((column) => column.name === "title_state_json")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN title_state_json TEXT
    `;
  }

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_issue_links (
      thread_id TEXT NOT NULL PRIMARY KEY,
      project_id TEXT NOT NULL,
      host TEXT NOT NULL,
      repository TEXT NOT NULL,
      number INTEGER NOT NULL,
      source TEXT NOT NULL,
      linked_at TEXT NOT NULL,
      branch TEXT,
      worktree_path TEXT,
      detached_at TEXT
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_issue_links_issue
    ON projection_issue_links(host, repository, number)
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_issue_detached_workspaces (
      thread_id TEXT NOT NULL PRIMARY KEY,
      project_id TEXT NOT NULL,
      branch TEXT,
      worktree_path TEXT,
      detached_at TEXT NOT NULL
    )
  `;
});
