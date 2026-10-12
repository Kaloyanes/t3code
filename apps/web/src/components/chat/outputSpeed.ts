import type { MessageId } from "@t3tools/contracts";

export type OutputObservation = { readonly messageId: MessageId; readonly textLength: number };
type Sample = { readonly at: number; readonly textLength: number };
export type OutputSampler = {
  readonly messageId: MessageId;
  readonly samples: readonly Sample[];
  readonly lastGrowthAt: number;
};
export type OutputSpeed =
  | { readonly kind: "unavailable" }
  | { readonly kind: "estimate"; readonly tokensPerSecond: number };
export const OUTPUT_IDLE_MS = 2000;
const WINDOW_MS = 5000;
const WARMUP_MS = 1000;

export function observeOutput(
  previous: OutputSampler | null,
  observation: OutputObservation,
  now: number,
): OutputSampler {
  const latest = previous?.samples.at(-1);
  if (
    !previous ||
    previous.messageId !== observation.messageId ||
    !latest ||
    observation.textLength < latest.textLength ||
    now - previous.lastGrowthAt >= OUTPUT_IDLE_MS ||
    now < latest.at
  ) {
    return {
      messageId: observation.messageId,
      samples: [{ at: now, textLength: observation.textLength }],
      lastGrowthAt: now,
    };
  }
  if (observation.textLength === latest.textLength) return previous;
  const samples = previous.samples.filter((sample) => now - sample.at <= WINDOW_MS);
  const last = samples.at(-1);
  if (samples.length > 1 && last && now - last.at < 100) samples.pop();
  samples.push({ at: now, textLength: observation.textLength });
  return { messageId: observation.messageId, samples, lastGrowthAt: now };
}

export function estimateOutput(sampler: OutputSampler, now: number): OutputSpeed {
  const first = sampler.samples[0];
  const last = sampler.samples.at(-1);
  if (
    !first ||
    !last ||
    last.at - first.at < WARMUP_MS ||
    now - sampler.lastGrowthAt >= OUTPUT_IDLE_MS ||
    last.textLength <= first.textLength
  )
    return { kind: "unavailable" };
  return {
    kind: "estimate",
    tokensPerSecond: (last.textLength - first.textLength) / 4 / ((last.at - first.at) / 1000),
  };
}

const FINISHED_MIN_DURATION_MS = 1500;

/**
 * Uses the saved message timestamps, which can cover the whole turn for imported history.
 * Replies delivered in one piece have no streaming window to measure.
 */
export function estimateFinishedOutput(message: {
  readonly text: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}): number | null {
  const durationMs = Date.parse(message.updatedAt) - Date.parse(message.createdAt);
  if (!Number.isFinite(durationMs) || durationMs < FINISHED_MIN_DURATION_MS) return null;
  const tokensPerSecond = message.text.length / 4 / (durationMs / 1000);
  return tokensPerSecond > 0 ? tokensPerSecond : null;
}

export function formatOutputSpeed(tokensPerSecond: number): string {
  return tokensPerSecond < 1 ? "<1" : String(Math.round(tokensPerSecond));
}
