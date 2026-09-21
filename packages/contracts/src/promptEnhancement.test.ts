import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  PromptEnhancementInput,
  PromptEnhancementResult,
  PromptEnhancementStreamEvent,
} from "./promptEnhancement.ts";

const decodeInput = Schema.decodeUnknownSync(PromptEnhancementInput);
const decodeResult = Schema.decodeUnknownSync(PromptEnhancementResult);
const decodeStreamEvent = Schema.decodeUnknownSync(PromptEnhancementStreamEvent);

describe("prompt enhancement contracts", () => {
  const input = {
    projectId: "project",
    prompt: "Fix [[T3_CONTEXT_0]]",
    references: [{ token: "[[T3_CONTEXT_0]]", label: "src/app.ts" }],
    attachments: [{ name: "trace.txt", mimeType: "text/plain" }],
  };

  it("decodes prompt context without interpreting opaque placeholders", () => {
    expect(decodeInput(input)).toEqual(input);
    expect(
      decodeInput({ ...input, selection: { start: 0, end: input.prompt.length } }),
    ).toMatchObject({ selection: { start: 0, end: input.prompt.length } });
    expect(decodeResult({ prompt: "Improve [[T3_CONTEXT_0]]" })).toEqual({
      prompt: "Improve [[T3_CONTEXT_0]]",
    });
  });

  it("rejects empty prompts, negative selection offsets, reference fields, attachment fields, and results", () => {
    expect(() => decodeInput({ ...input, prompt: "" })).toThrow();
    expect(decodeInput({ ...input, prompt: "  Fix it  " }).prompt).toBe("  Fix it  ");
    expect(() => decodeInput({ ...input, prompt: "   " })).toThrow();
    expect(() => decodeInput({ ...input, selection: { start: -1, end: 1 } })).toThrow();
    expect(() => decodeInput({ ...input, selection: { start: 0, end: 0 } })).toThrow();
    expect(() => decodeInput({ ...input, references: [{ token: "", label: "file" }] })).toThrow();
    expect(() =>
      decodeInput({ ...input, attachments: [{ name: "trace", mimeType: "" }] }),
    ).toThrow();
    expect(() => decodeResult({ prompt: "" })).toThrow();
  });

  it("decodes started, text delta, and completed stream events", () => {
    expect(decodeStreamEvent({ type: "started" })).toEqual({ type: "started" });
    expect(decodeStreamEvent({ type: "delta", delta: "Improve " })).toEqual({
      type: "delta",
      delta: "Improve ",
    });
    expect(decodeStreamEvent({ type: "complete", result: { prompt: "Improve it" } })).toEqual({
      type: "complete",
      result: { prompt: "Improve it" },
    });
    expect(() => decodeStreamEvent({ type: "delta", delta: "" })).toThrow();
  });
});
