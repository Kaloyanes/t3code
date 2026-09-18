import { describe, expect, it } from "vitest";
import { preparePromptEnhancement, restoreEnhancedPrompt } from "./promptEnhancement.ts";

describe("prompt enhancement references", () => {
  const reference = "[src/app.ts](t3-context://v1/file/ctx_1)";

  it("round trips opaque context references", () => {
    const prepared = preparePromptEnhancement(`Fix ${reference}`);
    expect(prepared.prompt).toBe("Fix [[T3_CONTEXT_0]]");
    expect(prepared.references).toEqual([{ token: "[[T3_CONTEXT_0]]", label: "src/app.ts" }]);
    expect(restoreEnhancedPrompt(prepared, `Please fix ${prepared.references[0]!.token}.`)).toBe(
      `Please fix ${reference}.`,
    );
  });

  it("rejects missing or duplicated placeholders", () => {
    const prepared = preparePromptEnhancement(`Fix ${reference}`);
    const token = prepared.references[0]!.token;
    expect(restoreEnhancedPrompt(prepared, "Fix the file")).toBeNull();
    expect(restoreEnhancedPrompt(prepared, `${token} ${token}`)).toBeNull();
  });

  it("avoids tokens already present in the draft", () => {
    const prepared = preparePromptEnhancement(`[[T3_CONTEXT_0]] ${reference}`);
    expect(prepared.references[0]!.token).toBe("_[[T3_CONTEXT_0]]");
  });
});
