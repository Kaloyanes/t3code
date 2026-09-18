import * as Schema from "effect/Schema";

import { ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const WorktreeRunTarget = Schema.Struct({
  projectId: ProjectId,
  workspacePath: TrimmedNonEmptyString,
  scriptId: TrimmedNonEmptyString,
});
export type WorktreeRunTarget = typeof WorktreeRunTarget.Type;

const sessionFields = WorktreeRunTarget.fields;
const cols = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(1000));
const rows = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(500));

export const WorktreeRunStartInput = Schema.Struct({
  ...sessionFields,
  cols: Schema.optional(cols),
  rows: Schema.optional(rows),
});
export const WorktreeRunAttachInput = Schema.Struct({
  ...sessionFields,
  cols: Schema.optional(cols),
  rows: Schema.optional(rows),
});
export const WorktreeRunWriteInput = Schema.Struct({
  ...sessionFields,
  data: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(65_536)),
});
export const WorktreeRunResizeInput = Schema.Struct({ ...sessionFields, cols, rows });
export const WorktreeRunSessionInput = WorktreeRunTarget;

export type WorktreeRunStartInput = typeof WorktreeRunStartInput.Type;
export type WorktreeRunAttachInput = typeof WorktreeRunAttachInput.Type;
export type WorktreeRunWriteInput = typeof WorktreeRunWriteInput.Type;
export type WorktreeRunResizeInput = typeof WorktreeRunResizeInput.Type;
export type WorktreeRunSessionInput = typeof WorktreeRunSessionInput.Type;

export const WorktreeRunStatus = Schema.Literals([
  "starting",
  "running",
  "stopped",
  "exited",
  "error",
]);
export type WorktreeRunStatus = typeof WorktreeRunStatus.Type;

export const WorktreeRunSnapshot = Schema.Struct({
  target: WorktreeRunTarget,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  status: WorktreeRunStatus,
  pid: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  history: Schema.String,
  exitCode: Schema.NullOr(Schema.Int),
  exitSignal: Schema.NullOr(Schema.Int),
  label: Schema.String,
  updatedAt: Schema.String,
});
export type WorktreeRunSnapshot = typeof WorktreeRunSnapshot.Type;

const { history: _history, ...worktreeRunSummaryFields } = WorktreeRunSnapshot.fields;
export const WorktreeRunSummary = Schema.Struct(worktreeRunSummaryFields);
export type WorktreeRunSummary = typeof WorktreeRunSummary.Type;

export const WorktreeRunAttachEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("snapshot"), snapshot: WorktreeRunSnapshot }),
  Schema.Struct({ type: Schema.Literal("output"), target: WorktreeRunTarget, data: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("exited"),
    target: WorktreeRunTarget,
    exitCode: Schema.NullOr(Schema.Int),
    exitSignal: Schema.NullOr(Schema.Int),
  }),
  Schema.Struct({ type: Schema.Literal("cleared"), target: WorktreeRunTarget }),
  Schema.Struct({ type: Schema.Literal("stopped"), target: WorktreeRunTarget }),
]);
export type WorktreeRunAttachEvent = typeof WorktreeRunAttachEvent.Type;

export const WorktreeRunMetadataEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("snapshot"), runs: Schema.Array(WorktreeRunSummary) }),
  Schema.Struct({ type: Schema.Literal("upsert"), run: WorktreeRunSummary }),
  Schema.Struct({ type: Schema.Literal("remove"), target: WorktreeRunTarget }),
]);
export type WorktreeRunMetadataEvent = typeof WorktreeRunMetadataEvent.Type;

export class WorktreeRunError extends Schema.TaggedError<WorktreeRunError>()("WorktreeRunError", {
  operation: Schema.String,
  message: Schema.String,
}) {}
