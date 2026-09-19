import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const PromptEnhancementReference = Schema.Struct({
  token: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
});
export type PromptEnhancementReference = typeof PromptEnhancementReference.Type;

export const PromptEnhancementAttachment = Schema.Struct({
  name: TrimmedNonEmptyString,
  mimeType: TrimmedNonEmptyString,
});
export type PromptEnhancementAttachment = typeof PromptEnhancementAttachment.Type;

export const PromptEnhancementSelection = Schema.Struct({
  start: NonNegativeInt,
  end: PositiveInt,
});
export type PromptEnhancementSelection = typeof PromptEnhancementSelection.Type;

const PromptEnhancementPrompt = Schema.String.check(
  Schema.makeFilter((prompt) => prompt.trim().length > 0),
);

export const PromptEnhancementInput = Schema.Struct({
  projectId: ProjectId,
  prompt: PromptEnhancementPrompt,
  selection: Schema.optionalKey(PromptEnhancementSelection),
  references: Schema.Array(PromptEnhancementReference),
  attachments: Schema.Array(PromptEnhancementAttachment),
});
export type PromptEnhancementInput = typeof PromptEnhancementInput.Type;

export const PromptEnhancementResult = Schema.Struct({ prompt: TrimmedNonEmptyString });
export type PromptEnhancementResult = typeof PromptEnhancementResult.Type;

export class PromptEnhancementError extends Schema.TaggedError<PromptEnhancementError>()(
  "PromptEnhancementError",
  { message: TrimmedNonEmptyString },
) {}
