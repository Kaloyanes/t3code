import { describe, expect, it } from "vitest";
import {
  preparePromptEnhancement,
  replaceEnhancedPromptTarget,
  restoreEnhancedPrompt,
} from "./promptEnhancement.ts";

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

  it("maps a selected context reference into the prepared prompt", () => {
    const first = "Keep this context.";
    const second = "Update this file";
    const prompt = `${first} ${reference} ${second}`;
    const sourceStart = prompt.indexOf(reference);
    const prepared = preparePromptEnhancement(prompt, {
      start: sourceStart + 1,
      end: sourceStart + reference.length - 1,
    });
    const token = prepared.references[0]!.token;

    expect(prepared.prompt).toBe(`${first} ${token} ${second}`);
    expect(prepared.selection).toEqual({
      start: prepared.prompt.indexOf(token),
      end: prepared.prompt.indexOf(token) + token.length,
    });
    expect(prepared.originalSelection).toEqual({
      start: sourceStart,
      end: sourceStart + reference.length,
    });
    expect(prepared.targetReferences).toEqual(prepared.references);
  });

  it("restores only references inside a selected range", () => {
    const firstReference = "[src/app.ts](t3-context://v1/file/ctx_1)";
    const secondReference = "[src/lib.ts](t3-context://v1/file/ctx_2)";
    const prompt = `${firstReference}\nUpdate ${secondReference}`;
    const secondStart = prompt.indexOf(secondReference);
    const prepared = preparePromptEnhancement(prompt, {
      start: secondStart,
      end: prompt.length,
    });
    const firstToken = prepared.references[0]!.token;
    const secondToken = prepared.references[1]!.token;

    expect(prepared.targetReferences).toEqual([prepared.references[1]]);
    expect(restoreEnhancedPrompt(prepared, `Improve ${secondToken}`)).toBe(
      `Improve ${secondReference}`,
    );
    expect(restoreEnhancedPrompt(prepared, `Improve ${firstToken}`)).toBeNull();
  });

  it("replaces only the original selected range", () => {
    const prompt = "Keep this. Fix the login flow. Keep this too.";
    const start = prompt.indexOf("Fix");
    const prepared = preparePromptEnhancement(prompt, {
      start,
      end: prompt.indexOf(".", start) + 1,
    });

    expect(replaceEnhancedPromptTarget(prompt, prepared, "Improve the login flow.")).toBe(
      "Keep this. Improve the login flow. Keep this too.",
    );
    expect(replaceEnhancedPromptTarget(prompt, preparePromptEnhancement(prompt), "Rewrite")).toBe(
      "Rewrite",
    );
  });

  it("uses the full prompt when the selection is empty or whitespace", () => {
    const prompt = "  Fix the login flow  ";

    expect(preparePromptEnhancement(prompt, { start: 0, end: 0 }).selection).toBeUndefined();
    expect(preparePromptEnhancement(prompt, { start: 0, end: 2 }).selection).toBeUndefined();
  });
});
