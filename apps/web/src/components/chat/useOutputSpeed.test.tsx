import { MessageId } from "@t3tools/contracts";
import { act, createElement, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { OutputObservation, OutputSpeed } from "./outputSpeed";
import { useOutputSpeed } from "./useOutputSpeed";

const messageId = MessageId.make("response");
let renderer: ReactTestRenderer | undefined;
let speeds: ReadonlyMap<MessageId, OutputSpeed> = new Map();
let document: EventTarget & { hidden: boolean };
function Probe({
  observations,
  threadKey = "environment:thread",
}: {
  observations: readonly OutputObservation[];
  threadKey?: string | undefined;
}) {
  const next = useOutputSpeed(threadKey, observations);
  useEffect(() => {
    speeds = next;
  }, [next]);
  return null;
}
function update(length: number, threadKey?: string) {
  act(() =>
    renderer?.update(
      createElement(Probe, { observations: [{ messageId, textLength: length }], threadKey }),
    ),
  );
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal("document", document);
  act(() => {
    renderer = create(createElement(Probe, { observations: [{ messageId, textLength: 4000 }] }));
  });
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("timeline output speed lifecycle", () => {
  it("publishes at most once a second, trails bursts and stops after idle", () => {
    act(() => vi.advanceTimersByTime(1000));
    update(4400);
    expect(speeds.get(messageId)).toEqual({ kind: "estimate", tokensPerSecond: 100 });
    act(() => vi.advanceTimersByTime(500));
    update(5200);
    expect(speeds.get(messageId)).toEqual({ kind: "estimate", tokensPerSecond: 100 });
    act(() => vi.advanceTimersByTime(500));
    expect(speeds.get(messageId)).toEqual({ kind: "estimate", tokensPerSecond: 200 });
    act(() => vi.advanceTimersByTime(1500));
    expect(speeds.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    update(5200);
    expect(speeds.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    update(8000);
    expect(speeds.size).toBe(0);
  });

  it("clears on completion, navigation, visibility suspension and unmount", () => {
    act(() => vi.advanceTimersByTime(1000));
    update(4400);
    expect(speeds.size).toBe(1);
    update(4400, "other:thread");
    expect(speeds.size).toBe(0);
    act(() => vi.advanceTimersByTime(1000));
    update(4800, "other:thread");
    expect(speeds.size).toBe(1);
    act(() => {
      document.hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(speeds.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      document.hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => renderer?.update(createElement(Probe, { observations: [] })));
    expect(vi.getTimerCount()).toBe(0);
    update(5000);
    act(() => renderer?.unmount());
    renderer = undefined;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("samples overlapping messages independently", () => {
    const otherId = MessageId.make("other");
    act(() =>
      renderer?.update(
        createElement(Probe, {
          observations: [
            { messageId, textLength: 4000 },
            { messageId: otherId, textLength: 2000 },
          ],
        }),
      ),
    );
    act(() => vi.advanceTimersByTime(1000));
    act(() =>
      renderer?.update(
        createElement(Probe, {
          observations: [
            { messageId, textLength: 4400 },
            { messageId: otherId, textLength: 2200 },
          ],
        }),
      ),
    );
    expect(speeds.get(messageId)).toEqual({ kind: "estimate", tokensPerSecond: 100 });
    expect(speeds.get(otherId)).toEqual({ kind: "estimate", tokensPerSecond: 50 });
  });
});
