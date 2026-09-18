import {
  collectComposerContextReferences,
  replaceComposerContextReferences,
} from "@t3tools/shared/composerContextReferences";

export interface PreparedPromptEnhancement {
  prompt: string;
  references: ReadonlyArray<{ token: string; label: string }>;
  originals: ReadonlyMap<string, string>;
}

function tokenFor(index: number, prompt: string): string {
  let token = `[[T3_CONTEXT_${index}]]`;
  while (prompt.includes(token)) token = `_${token}`;
  return token;
}

export function preparePromptEnhancement(prompt: string): PreparedPromptEnhancement {
  const originals = new Map<string, string>();
  const references = collectComposerContextReferences(prompt).map((reference, index) => {
    const token = tokenFor(index, prompt);
    originals.set(token, reference.source);
    return { token, label: reference.label };
  });
  let index = 0;
  return {
    prompt: replaceComposerContextReferences(prompt, () => references[index++]!.token),
    references,
    originals,
  };
}

export function restoreEnhancedPrompt(
  prepared: PreparedPromptEnhancement,
  enhancedPrompt: string,
): string | null {
  for (const { token } of prepared.references) {
    if (enhancedPrompt.split(token).length !== 2) return null;
  }
  let restored = enhancedPrompt;
  for (const [token, original] of prepared.originals) restored = restored.replace(token, original);
  return restored;
}
