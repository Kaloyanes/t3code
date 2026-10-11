import { MessageId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { estimateOutput, observeOutput } from "./outputSpeed";

const messageId = MessageId.make("response");
const observation = (textLength: number) => ({ messageId, textLength });

describe("visible output speed", () => {
  it("uses hydrated accumulated text only as a baseline and requires a full second", () => {
    let sampler = observeOutput(null, observation(4000), 0);
    sampler = observeOutput(sampler, observation(4200), 500);
    expect(estimateOutput(sampler, 500)).toEqual({ kind: "unavailable" });
    sampler = observeOutput(sampler, observation(4400), 1000);
    expect(estimateOutput(sampler, 1000)).toEqual({ kind: "estimate", tokensPerSecond: 100 });
  });

  it("smooths delivery bursts over the observation window", () => {
    let sampler = observeOutput(null, observation(0), 0);
    sampler = observeOutput(sampler, observation(400), 1000);
    sampler = observeOutput(sampler, observation(1200), 1500);
    expect(estimateOutput(sampler, 1500)).toEqual({ kind: "estimate", tokensPerSecond: 200 });
  });

  it("hides idle output and starts a new baseline after the gap", () => {
    let sampler = observeOutput(null, observation(0), 0);
    sampler = observeOutput(sampler, observation(400), 1000);
    expect(estimateOutput(sampler, 3000)).toEqual({ kind: "unavailable" });
    sampler = observeOutput(sampler, observation(10000), 3001);
    expect(estimateOutput(sampler, 3001)).toEqual({ kind: "unavailable" });
    sampler = observeOutput(sampler, observation(10400), 4001);
    expect(estimateOutput(sampler, 4001)).toEqual({ kind: "estimate", tokensPerSecond: 100 });
  });

  it("resets rollback, identity changes and a reversed local clock", () => {
    const sampler = observeOutput(observeOutput(null, observation(0), 0), observation(400), 1000);
    for (const reset of [
      observeOutput(sampler, observation(100), 1500),
      observeOutput(sampler, { messageId: MessageId.make("other"), textLength: 4000 }, 1500),
      observeOutput(sampler, observation(800), 500),
    ])
      expect(estimateOutput(reset, 1500)).toEqual({ kind: "unavailable" });
  });

  it("bounds samples under many arrivals and ignores unchanged text", () => {
    let sampler = observeOutput(null, observation(0), 0);
    for (let now = 1; now <= 20000; now++)
      sampler = observeOutput(sampler, observation(now * 4), now);
    expect(sampler.samples.length).toBeLessThanOrEqual(52);
    expect(estimateOutput(sampler, 20000)).toEqual({ kind: "estimate", tokensPerSecond: 1000 });
    expect(observeOutput(sampler, observation(80000), 20500)).toBe(sampler);
  });
});
