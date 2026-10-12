import { MessageId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  estimateFinishedOutput,
  estimateOutput,
  formatOutputSpeed,
  observeOutput,
} from "./outputSpeed";

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

  it("preserves slow streaming output below one token per second", () => {
    const sampler = observeOutput(observeOutput(null, observation(0), 0), observation(1), 1000);
    const speed = estimateOutput(sampler, 1000);
    expect(speed).toEqual({ kind: "estimate", tokensPerSecond: 0.25 });
    if (speed.kind === "estimate") expect(formatOutputSpeed(speed.tokensPerSecond)).toBe("<1");
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

describe("finished output speed", () => {
  const message = (text: string, seconds: number) => ({
    text,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString(),
  });

  it("averages visible text over the message's update span", () => {
    expect(estimateFinishedOutput(message("x".repeat(4000), 10))).toBe(100);
  });

  it("keeps short replies visible after a long turn", () => {
    const speed = estimateFinishedOutput({
      text: "x".repeat(143),
      createdAt: "2026-10-11T15:36:34.661Z",
      updatedAt: "2026-10-11T15:52:10.755Z",
    });
    expect(speed).toBeGreaterThan(0);
    if (speed !== null) expect(formatOutputSpeed(speed)).toBe("<1");
  });

  it("has nothing to say for replies delivered in one piece", () => {
    expect(estimateFinishedOutput(message("x".repeat(4000), 0))).toBeNull();
    expect(estimateFinishedOutput(message("x".repeat(4000), 1))).toBeNull();
  });

  it("hides replies without visible text or valid timing", () => {
    expect(estimateFinishedOutput(message("", 10))).toBeNull();
    expect(estimateFinishedOutput(message("hello", -10))).toBeNull();
    expect(estimateFinishedOutput({ ...message("hello", 10), updatedAt: "invalid" })).toBeNull();
  });
});

describe("output speed labels", () => {
  it.each([
    [0.04, "<1"],
    [0.9, "<1"],
    [1, "1"],
    [123.6, "124"],
  ])("formats %s tokens per second as %s", (speed, label) => {
    expect(formatOutputSpeed(speed)).toBe(label);
  });
});
