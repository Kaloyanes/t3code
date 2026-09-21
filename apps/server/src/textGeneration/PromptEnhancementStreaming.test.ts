import { describe, expect, it } from "vite-plus/test";

import { makePromptEnhancementJsonDeltaDecoder } from "./PromptEnhancementStreaming.ts";

describe("prompt enhancement JSON delta decoder", () => {
  it("emits prompt text while a structured response is still arriving", () => {
    const decode = makePromptEnhancementJsonDeltaDecoder();

    expect(decode('{"prompt":"Improve ')).toBe("Improve ");
    expect(decode("the request")).toBe("the request");
    expect(decode('"}')).toBe("");
  });

  it("preserves JSON escapes split across chunks", () => {
    const decode = makePromptEnhancementJsonDeltaDecoder();

    expect(decode('{"prompt":"Line one\\')).toBe("Line one");
    expect(decode('nQuoted: \\"yes\\" \\u2')).toBe('\nQuoted: "yes" ');
    expect(decode('026"}')).toBe("…");
  });

  it("ignores text outside the prompt field", () => {
    const decode = makePromptEnhancementJsonDeltaDecoder();

    expect(decode('status\n{"other":"prompt",')).toBe("");
    expect(decode('"prompt" : "Ready"} trailing')).toBe("Ready");
  });
});
