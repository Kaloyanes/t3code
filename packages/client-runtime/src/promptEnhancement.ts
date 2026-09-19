import {
  collectComposerContextReferences,
  replaceComposerContextReferences,
} from "@t3tools/shared/composerContextReferences";

export interface PreparedPromptEnhancement {
  prompt: string;
  references: ReadonlyArray<{ token: string; label: string }>;
  originals: ReadonlyMap<string, string>;
  selection?: PromptEnhancementRange;
  originalSelection?: PromptEnhancementRange;
  targetReferences: ReadonlyArray<{ token: string; label: string }>;
}

export interface PromptEnhancementRange {
  start: number;
  end: number;
}

function tokenFor(index: number, prompt: string): string {
  let token = `[[T3_CONTEXT_${index}]]`;
  while (prompt.includes(token)) token = `_${token}`;
  return token;
}

function normalizeSelection(
  prompt: string,
  selection: PromptEnhancementRange | undefined,
  occurrences: ReadonlyArray<{ start: number; end: number }>,
): PromptEnhancementRange | undefined {
  if (!selection || selection.start >= selection.end) return undefined;
  let start = Math.max(0, Math.min(prompt.length, selection.start));
  let end = Math.max(start, Math.min(prompt.length, selection.end));
  for (const occurrence of occurrences) {
    if (occurrence.start >= end || occurrence.end <= start) continue;
    start = Math.min(start, occurrence.start);
    end = Math.max(end, occurrence.end);
  }
  return prompt.slice(start, end).trim().length > 0 ? { start, end } : undefined;
}

export function preparePromptEnhancement(
  prompt: string,
  selection?: PromptEnhancementRange,
): PreparedPromptEnhancement {
  const originals = new Map<string, string>();
  const occurrences = collectComposerContextReferences(prompt);
  const originalSelection = normalizeSelection(prompt, selection, occurrences);
  const references = occurrences.map((reference, index) => {
    const token = tokenFor(index, prompt);
    originals.set(token, reference.source);
    return { token, label: reference.label };
  });
  let index = 0;
  const preparedPrompt = replaceComposerContextReferences(prompt, () => references[index++]!.token);
  const offsetFor = (offset: number) =>
    offset +
    occurrences.reduce(
      (total, occurrence, occurrenceIndex) =>
        occurrence.end <= offset
          ? total + references[occurrenceIndex]!.token.length - occurrence.source.length
          : total,
      0,
    );
  const preparedSelection = originalSelection
    ? { start: offsetFor(originalSelection.start), end: offsetFor(originalSelection.end) }
    : undefined;
  const targetReferences = originalSelection
    ? occurrences.flatMap((occurrence, occurrenceIndex) =>
        occurrence.start >= originalSelection.start && occurrence.end <= originalSelection.end
          ? [references[occurrenceIndex]!]
          : [],
      )
    : references;
  return {
    prompt: preparedPrompt,
    references,
    originals,
    ...(preparedSelection ? { selection: preparedSelection } : {}),
    ...(originalSelection ? { originalSelection } : {}),
    targetReferences,
  };
}

export function restoreEnhancedPrompt(
  prepared: PreparedPromptEnhancement,
  enhancedPrompt: string,
): string | null {
  const targetTokens = new Set(prepared.targetReferences.map(({ token }) => token));
  for (const { token } of prepared.targetReferences) {
    if (enhancedPrompt.split(token).length !== 2) return null;
  }
  if (
    prepared.references.some(
      ({ token }) => !targetTokens.has(token) && enhancedPrompt.includes(token),
    )
  ) {
    return null;
  }
  let restored = enhancedPrompt;
  for (const { token } of prepared.targetReferences) {
    const original = prepared.originals.get(token);
    if (original) restored = restored.replace(token, original);
  }
  return restored;
}

export function replaceEnhancedPromptTarget(
  prompt: string,
  prepared: PreparedPromptEnhancement,
  replacement: string,
): string {
  const selection = prepared.originalSelection;
  return selection
    ? `${prompt.slice(0, selection.start)}${replacement}${prompt.slice(selection.end)}`
    : replacement;
}
