import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { PromptEnhancementInput, PromptEnhancementResult } from "./promptEnhancement.ts";

const decodeInput = Schema.decodeUnknownSync(PromptEnhancementInput);
const decodeResult = Schema.decodeUnknownSync(PromptEnhancementResult);

describe("prompt enhancement contracts", () => {
  const input = {
    projectId: "project",
    prompt: "Fix [[T3_CONTEXT_0]]",
    references: [{ token: "[[T3_CONTEXT_0]]", label: "src/app.ts" }],
    attachments: [{ name: "trace.txt", mimeType: "text/plain" }],
  };

  it("decodes prompt context without interpreting opaque placeholders", () => {
    expect(decodeInput(input)).toEqual(input);
    expect(decodeResult({ prompt: "Improve [[T3_CONTEXT_0]]" })).toEqual({
      prompt: "Improve [[T3_CONTEXT_0]]",
    });
  });

  it("rejects empty prompts, reference fields, attachment fields, and results", () => {
    expect(() => decodeInput({ ...input, prompt: "" })).toThrow();
    expect(() => decodeInput({ ...input, references: [{ token: "", label: "file" }] })).toThrow();
    expect(() =>
      decodeInput({ ...input, attachments: [{ name: "trace", mimeType: "" }] }),
    ).toThrow();
    expect(() => decodeResult({ prompt: "" })).toThrow();
  });
});
