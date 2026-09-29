import * as Schema from "effect/Schema";
import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const UsageResume = Schema.Struct({
  id: TrimmedNonEmptyString,
  threadId: ThreadId,
  prompt: TrimmedNonEmptyString,
  scheduledAt: IsoDateTime,
  status: Schema.Literals(["pending", "dispatching", "dispatched", "canceled", "failed"]),
  reason: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type UsageResume = typeof UsageResume.Type;
export const UsageResumeEligibility = Schema.Struct({
  available: Schema.Boolean,
  resetsAt: Schema.NullOr(IsoDateTime),
  reason: Schema.NullOr(Schema.String),
  defaultPrompt: Schema.NullOr(Schema.String),
});
export type UsageResumeEligibility = typeof UsageResumeEligibility.Type;
export const UsageResumeSnapshot = Schema.Struct({
  threadId: ThreadId,
  eligibility: UsageResumeEligibility,
  schedule: Schema.NullOr(UsageResume),
});
export type UsageResumeSnapshot = typeof UsageResumeSnapshot.Type;
export const UsageResumeGetInput = Schema.Struct({ threadId: ThreadId });
export type UsageResumeGetInput = typeof UsageResumeGetInput.Type;
export const UsageResumeScheduleInput = Schema.Struct({
  threadId: ThreadId,
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(100_000)),
});
export type UsageResumeScheduleInput = typeof UsageResumeScheduleInput.Type;
export const UsageResumeCancelInput = Schema.Struct({
  threadId: ThreadId,
  id: TrimmedNonEmptyString,
});
export type UsageResumeCancelInput = typeof UsageResumeCancelInput.Type;
export class UsageResumeError extends Schema.TaggedError<UsageResumeError>()("UsageResumeError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}
