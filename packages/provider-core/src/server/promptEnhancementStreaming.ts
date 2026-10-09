import * as Effect from "effect/Effect";

const JSON_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

export function makePromptEnhancementJsonDeltaDecoder() {
  let prefix = "";
  let readingPrompt = false;
  let escaped = false;
  let unicodeDigits: string | null = null;
  let complete = false;

  return (chunk: string): string => {
    if (complete || chunk.length === 0) return "";

    let input = chunk;
    if (!readingPrompt) {
      prefix += chunk;
      const match = /"prompt"\s*:\s*"/.exec(prefix);
      if (match === null) {
        prefix = prefix.slice(-64);
        return "";
      }
      input = prefix.slice(match.index + match[0].length);
      prefix = "";
      readingPrompt = true;
    }

    let decoded = "";
    for (const character of input) {
      if (unicodeDigits !== null) {
        unicodeDigits += character;
        if (unicodeDigits.length === 4) {
          if (/^[0-9a-f]{4}$/i.test(unicodeDigits)) {
            decoded += String.fromCharCode(Number.parseInt(unicodeDigits, 16));
          }
          unicodeDigits = null;
        }
        continue;
      }
      if (escaped) {
        escaped = false;
        if (character === "u") {
          unicodeDigits = "";
        } else {
          decoded += JSON_ESCAPES[character] ?? character;
        }
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === '"') {
        complete = true;
        break;
      }
      decoded += character;
    }
    return decoded;
  };
}

export function makePromptEnhancementJsonDeltaHandler(
  onDelta: ((delta: string) => Effect.Effect<void>) | undefined,
) {
  const decode = makePromptEnhancementJsonDeltaDecoder();
  return onDelta === undefined
    ? undefined
    : (chunk: string) => {
        const delta = decode(chunk);
        return delta.length > 0 ? onDelta(delta) : Effect.void;
      };
}
