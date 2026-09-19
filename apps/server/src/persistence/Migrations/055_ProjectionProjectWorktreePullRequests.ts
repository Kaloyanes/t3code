import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_project_worktree_pull_requests (
      project_id TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      host TEXT NOT NULL,
      repository TEXT NOT NULL,
      number INTEGER NOT NULL,
      url TEXT NOT NULL,
      source TEXT NOT NULL,
      linked_at TEXT NOT NULL,
      snapshot_json TEXT,
      stack_json TEXT,
      PRIMARY KEY (project_id, worktree_path, host, repository, number)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_project_worktree_pull_requests_project
    ON projection_project_worktree_pull_requests(project_id, worktree_path)
  `;

  yield* sql`
    INSERT OR IGNORE INTO projection_project_worktree_pull_requests (
      project_id,
      worktree_path,
      host,
      repository,
      number,
      url,
      source,
      linked_at,
      snapshot_json,
      stack_json
    )
    SELECT
      threads.project_id,
      COALESCE(threads.worktree_path, ''),
      links.host,
      links.repository,
      links.number,
      links.url,
      links.source,
      links.linked_at,
      links.snapshot_json,
      links.stack_json
    FROM projection_thread_pull_requests AS links
    INNER JOIN projection_threads AS threads
      ON threads.thread_id = links.thread_id
    WHERE links.source = 'created'
    ORDER BY links.linked_at ASC, links.thread_id ASC
  `;
});
