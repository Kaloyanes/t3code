import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection, ProviderInteractionMode, RuntimeMode } from "./orchestration.ts";

const LocalDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));
const LocalTime = Schema.String.check(Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/));
const TimeZone = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
const Weekday = Schema.Literals([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

export const AutomationId = TrimmedNonEmptyString.pipe(Schema.brand("AutomationId"));
export type AutomationId = typeof AutomationId.Type;

export const AutomationRunId = TrimmedNonEmptyString.pipe(Schema.brand("AutomationRunId"));
export type AutomationRunId = typeof AutomationRunId.Type;

export const AutomationSchedule = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("once"),
    date: LocalDate,
    time: LocalTime,
    timeZone: TimeZone,
  }),
  Schema.Struct({
    kind: Schema.Literal("daily"),
    time: LocalTime,
    timeZone: TimeZone,
  }),
  Schema.Struct({
    kind: Schema.Literal("weekly"),
    days: Schema.Array(Weekday).check(Schema.isMinLength(1)),
    time: LocalTime,
    timeZone: TimeZone,
  }),
]);
export type AutomationSchedule = typeof AutomationSchedule.Type;

export const AutomationExecution = Schema.Struct({
  modelSelection: ModelSelection,
  baseBranch: TrimmedNonEmptyString,
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed("approval-required"))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("default")),
  ),
  worktreePolicy: Schema.Literal("dedicated").pipe(
    Schema.withDecodingDefault(Effect.succeed("dedicated")),
  ),
  timeoutMs: Schema.optional(NonNegativeInt),
  inputTimeoutMs: Schema.optional(NonNegativeInt),
});
export type AutomationExecution = typeof AutomationExecution.Type;

export const AutomationStatus = Schema.Literals(["active", "paused", "canceled"]);
export type AutomationStatus = typeof AutomationStatus.Type;

export const AutomationRunStatus = Schema.Literals([
  "scheduled",
  "running",
  "waiting-for-input",
  "completed",
  "failed",
  "skipped",
  "missed",
  "canceled",
]);
export type AutomationRunStatus = typeof AutomationRunStatus.Type;

export const AutomationRunTrigger = Schema.Literals(["schedule", "manual", "retry"]);
export type AutomationRunTrigger = typeof AutomationRunTrigger.Type;

export const Automation = Schema.Struct({
  id: AutomationId,
  projectId: ProjectId,
  name: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  schedule: AutomationSchedule,
  execution: AutomationExecution,
  status: AutomationStatus,
  nextRunAt: Schema.NullOr(IsoDateTime),
  lastRunId: Schema.NullOr(AutomationRunId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Automation = typeof Automation.Type;

export const AutomationRun = Schema.Struct({
  id: AutomationRunId,
  automationId: AutomationId,
  projectId: ProjectId,
  threadId: Schema.NullOr(TrimmedNonEmptyString),
  trigger: AutomationRunTrigger,
  prompt: TrimmedNonEmptyString,
  execution: AutomationExecution,
  scheduledAt: IsoDateTime,
  status: AutomationRunStatus,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  lateByMs: NonNegativeInt,
  reason: Schema.NullOr(TrimmedNonEmptyString),
});
export type AutomationRun = typeof AutomationRun.Type;

export const AutomationSnapshot = Schema.Struct({
  automations: Schema.Array(Automation),
  runs: Schema.Array(AutomationRun),
});
export type AutomationSnapshot = typeof AutomationSnapshot.Type;

export const AutomationCreateInput = Schema.Struct({
  projectId: ProjectId,
  name: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  schedule: AutomationSchedule,
  execution: AutomationExecution,
});
export type AutomationCreateInput = typeof AutomationCreateInput.Type;

export const AutomationUpdateInput = Schema.Struct({
  id: AutomationId,
  name: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  schedule: AutomationSchedule,
  execution: AutomationExecution,
});
export type AutomationUpdateInput = typeof AutomationUpdateInput.Type;

export const AutomationIdInput = Schema.Struct({ id: AutomationId });
export type AutomationIdInput = typeof AutomationIdInput.Type;

export const AutomationRunIdInput = Schema.Struct({ id: AutomationRunId });
export type AutomationRunIdInput = typeof AutomationRunIdInput.Type;
