import type { MessageId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import {
  estimateOutput,
  observeOutput,
  OUTPUT_IDLE_MS,
  type OutputObservation,
  type OutputSampler,
  type OutputSpeed,
} from "./outputSpeed";

const EMPTY_SPEEDS: ReadonlyMap<MessageId, OutputSpeed> = new Map();

export function useOutputSpeed(
  threadKey: string,
  observations: readonly OutputObservation[],
): ReadonlyMap<MessageId, OutputSpeed> {
  const samplers = useRef(new Map<MessageId, OutputSampler>());
  const lastObservedLengths = useRef(new Map<MessageId, number>());
  const [speeds, setSpeeds] = useState(EMPTY_SPEEDS);
  const [publishedThreadKey, setPublishedThreadKey] = useState(threadKey);
  const publishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPublishAt = useRef(-Infinity);
  const scope = useRef(threadKey);
  const observationsRef = useRef(observations);
  const callbacks = useRef({ publish: () => {}, scheduleIdle: () => {} });

  useEffect(() => {
    const clearTimers = () => {
      if (publishTimer.current !== null) clearTimeout(publishTimer.current);
      if (idleTimer.current !== null) clearTimeout(idleTimer.current);
      publishTimer.current = null;
      idleTimer.current = null;
    };
    const reset = () => {
      clearTimers();
      samplers.current.clear();
      lastObservedLengths.current.clear();
      lastPublishAt.current = -Infinity;
      setSpeeds(EMPTY_SPEEDS);
    };
    const publish = () => {
      publishTimer.current = null;
      const now = performance.now();
      lastPublishAt.current = now;
      const next = new Map<MessageId, OutputSpeed>();
      for (const [messageId, sampler] of samplers.current) {
        const speed = estimateOutput(sampler, now);
        if (speed.kind === "estimate") next.set(messageId, speed);
      }
      setSpeeds((previous) =>
        previous.size === next.size &&
        [...next].every(([id, speed]) => {
          const old = previous.get(id);
          return (
            old?.kind === "estimate" &&
            speed.kind === "estimate" &&
            old.tokensPerSecond === speed.tokensPerSecond
          );
        })
          ? previous
          : next,
      );
    };
    const scheduleIdle = () => {
      if (idleTimer.current !== null) clearTimeout(idleTimer.current);
      idleTimer.current = null;
      let earliest = Infinity;
      for (const sampler of samplers.current.values())
        earliest = Math.min(earliest, sampler.lastGrowthAt + OUTPUT_IDLE_MS);
      if (!Number.isFinite(earliest)) return;
      idleTimer.current = setTimeout(
        () => {
          idleTimer.current = null;
          const now = performance.now();
          for (const [id, sampler] of samplers.current)
            if (now - sampler.lastGrowthAt >= OUTPUT_IDLE_MS) samplers.current.delete(id);
          setSpeeds((previous) => {
            const next = new Map(previous);
            for (const id of previous.keys()) if (!samplers.current.has(id)) next.delete(id);
            return next.size === previous.size ? previous : next;
          });
          scheduleIdle();
        },
        Math.max(0, earliest - performance.now()),
      );
    };
    callbacks.current = { publish, scheduleIdle };
    const visibilityChanged = () => {
      reset();
      if (!document.hidden) {
        const now = performance.now();
        for (const observation of observationsRef.current) {
          samplers.current.set(observation.messageId, observeOutput(null, observation, now));
          lastObservedLengths.current.set(observation.messageId, observation.textLength);
        }
        scheduleIdle();
      }
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      clearTimers();
      samplers.current.clear();
      lastObservedLengths.current.clear();
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, []);

  useEffect(() => {
    observationsRef.current = observations;
    if (scope.current !== threadKey || document.hidden || observations.length === 0) {
      scope.current = threadKey;
      setPublishedThreadKey(threadKey);
      samplers.current.clear();
      lastObservedLengths.current.clear();
      if (publishTimer.current !== null) clearTimeout(publishTimer.current);
      if (idleTimer.current !== null) clearTimeout(idleTimer.current);
      publishTimer.current = null;
      idleTimer.current = null;
      lastPublishAt.current = -Infinity;
      setSpeeds(EMPTY_SPEEDS);
    }
    if (document.hidden) return;
    const now = performance.now();
    const activeIds = new Set(observations.map((observation) => observation.messageId));
    for (const id of samplers.current.keys()) if (!activeIds.has(id)) samplers.current.delete(id);
    for (const id of lastObservedLengths.current.keys())
      if (!activeIds.has(id)) lastObservedLengths.current.delete(id);
    let grew = false;
    for (const observation of observations) {
      const sampler = samplers.current.get(observation.messageId);
      const previousLength = lastObservedLengths.current.get(observation.messageId);
      lastObservedLengths.current.set(observation.messageId, observation.textLength);
      if (!sampler && previousLength === observation.textLength) continue;
      const latestLength = sampler?.samples.at(-1)?.textLength;
      if (latestLength !== undefined && observation.textLength > latestLength) grew = true;
      samplers.current.set(observation.messageId, observeOutput(sampler ?? null, observation, now));
    }
    setSpeeds((previous) => {
      const next = new Map(previous);
      for (const id of previous.keys()) {
        const sampler = samplers.current.get(id);
        if (!sampler || estimateOutput(sampler, now).kind === "unavailable") next.delete(id);
      }
      return next.size === previous.size ? previous : next;
    });
    callbacks.current.scheduleIdle();
    if (!grew) return;
    if (now - lastPublishAt.current >= 1000) callbacks.current.publish();
    else if (publishTimer.current === null)
      publishTimer.current = setTimeout(
        () => callbacks.current.publish(),
        1000 - (now - lastPublishAt.current),
      );
  }, [threadKey, observations]);
  return publishedThreadKey === threadKey ? speeds : EMPTY_SPEEDS;
}
