import { describe, expect, it } from "@effect/vitest";
import { RunId, ThreadId, type OrchestrationV2PendingBackgroundTask } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { make, supportsKeepAwake, threadKeepsHostAwake } from "./keepAwake.ts";

const a = ThreadId.make("a");
const b = ThreadId.make("b");

function harness(platform: NodeJS.Platform = "darwin", exists = true) {
  let starts = 0;
  let stops = 0;
  let running = false;
  let fail = false;
  const commands: unknown[] = [];
  const spawner = ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      commands.push(command);
      if (fail)
        return yield* PlatformError.systemError({
          module: "ChildProcess",
          method: "spawn",
          _tag: "NotFound",
          description: "missing",
        });
      starts++;
      running = true;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          stops++;
          running = false;
        }),
      );
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(123),
        exitCode: Effect.never,
        isRunning: Effect.sync(() => running),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout: Stream.empty,
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      });
    }),
  );
  const layer = Layer.mergeAll(
    Layer.succeed(HostProcessPlatform, platform),
    FileSystem.layerNoop({ exists: () => Effect.succeed(exists) }),
    Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
  );
  return {
    layer,
    commands,
    starts: () => starts,
    stops: () => stops,
    fail: (value: boolean) => {
      fail = value;
    },
    crash: () => {
      running = false;
    },
  };
}

describe("keep awake", () => {
  it("counts active runs and pending background work, but not monitors, as agent work", () => {
    const task = (kind: "subagent" | "monitor") =>
      ({ kind }) as OrchestrationV2PendingBackgroundTask;
    expect(threadKeepsHostAwake(null)).toBe(false);
    expect(threadKeepsHostAwake({ activeRunId: null, pendingBackgroundTasks: [] })).toBe(false);
    expect(
      threadKeepsHostAwake({ activeRunId: RunId.make("run"), pendingBackgroundTasks: [] }),
    ).toBe(true);
    expect(
      threadKeepsHostAwake({ activeRunId: null, pendingBackgroundTasks: [task("subagent")] }),
    ).toBe(true);
    expect(
      threadKeepsHostAwake({ activeRunId: null, pendingBackgroundTasks: [task("monitor")] }),
    ).toBe(false);
  });

  it.effect("holds one assertion across overlapping threads and releases it after the last", () => {
    const h = harness();
    return Effect.gen(function* () {
      const controller = yield* make;
      yield* controller.setEnabled(true);
      expect(h.starts()).toBe(0);
      yield* controller.setThreadWorking(a, true);
      yield* controller.setThreadWorking(b, true);
      expect(h.starts()).toBe(1);
      expect(h.commands[0]).toMatchObject({
        command: "/usr/bin/caffeinate",
        args: ["-i", "-w", String(process.pid)],
      });
      yield* controller.setThreadWorking(a, false);
      expect(h.stops()).toBe(0);
      yield* controller.setThreadWorking(b, false);
      expect(h.stops()).toBe(1);
    }).pipe(Effect.provide(h.layer), Effect.scoped);
  });

  it.effect("applies setting changes mid-run and cleans up on shutdown", () => {
    const h = harness();
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const controller = yield* make;
        yield* controller.setThreadWorking(a, true);
        expect(h.starts()).toBe(0);
        yield* controller.setEnabled(true);
        expect(h.starts()).toBe(1);
        yield* controller.setEnabled(false);
        expect(h.stops()).toBe(1);
        yield* controller.setThreadWorking(a, false);
        yield* controller.setEnabled(true);
        expect(h.starts()).toBe(1);
        yield* controller.setThreadWorking(b, true);
      }).pipe(Effect.scoped);
      expect(h.starts()).toBe(2);
      expect(h.stops()).toBe(2);
    }).pipe(Effect.provide(h.layer));
  });

  it.effect("recovers from spawn failure and unexpected exit on the next change", () => {
    const h = harness();
    return Effect.gen(function* () {
      const controller = yield* make;
      yield* controller.setEnabled(true);
      h.fail(true);
      yield* controller.setThreadWorking(a, true);
      expect(h.starts()).toBe(0);
      h.fail(false);
      yield* controller.setThreadWorking(a, true);
      expect(h.starts()).toBe(1);
      h.crash();
      yield* controller.setThreadWorking(b, true);
      expect(h.starts()).toBe(2);
    }).pipe(Effect.provide(h.layer), Effect.scoped);
  });

  for (const [platform, exists] of [
    ["linux", true],
    ["win32", true],
    ["darwin", false],
  ] as const) {
    it.effect(`does not spawn on unsupported host ${platform}/${exists}`, () => {
      const h = harness(platform, exists);
      return Effect.gen(function* () {
        expect(yield* supportsKeepAwake).toBe(false);
        const controller = yield* make;
        yield* controller.setEnabled(true);
        yield* controller.setThreadWorking(a, true);
        expect(h.starts()).toBe(0);
      }).pipe(Effect.provide(h.layer), Effect.scoped);
    });
  }
});
