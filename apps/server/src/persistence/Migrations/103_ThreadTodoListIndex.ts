import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Keep this predicate aligned with ProjectionStore's latest todo list shell query.
  yield* sql`
    CREATE INDEX orchestration_v2_projection_turn_items_todo_list_idx
    ON orchestration_v2_projection_turn_items(thread_id, updated_at DESC, turn_item_id DESC)
    WHERE type = 'todo_list'
  `;
});
