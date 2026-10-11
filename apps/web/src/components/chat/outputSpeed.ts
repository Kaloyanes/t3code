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
    tokensPerSecond: Math.round(
      (last.textLength - first.textLength) / 4 / ((last.at - first.at) / 1000),
    ),
  };
}
