import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  EventId,
  ThreadId,
  type OrchestrationEvent,
  type ServerSettings,
  type OrchestrationSession,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import {
  layer as KeepAwakeLayer,
  make,
  supportsKeepAwake,
  type KeepAwakeEvent,
} from "./keepAwake.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { ServerSettingsService } from "./serverSettings.ts";
import { ServerActivation } from "./serverActivation.ts";
import * as Background from "./orchestration/ThreadBackgroundLiveness.ts";

const now = "2026-09-29T12:00:00.000Z";
const session = (id: string, status: OrchestrationSession["status"]): KeepAwakeEvent => ({
  type: "thread.session-set",
  payload: {
    threadId: ThreadId.make(id),
    session: {
      threadId: ThreadId.make(id),
      status,
      providerName: "codex",
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: null,
      updatedAt: now,
    },
  },
});
const activity = (id: string): KeepAwakeEvent => ({
  type: "thread.activity-appended",
  payload: {
    threadId: ThreadId.make(id),
    activity: {
      id: EventId.make("task-event"),
      kind: "task.updated",
      tone: "info",
      summary: "Task changed",
      payload: {},
      turnId: null,
      createdAt: now,
    },
  },
});

function harness(
  platform: NodeJS.Platform = "darwin",
  exists = true,
  receipts?: Queue.Queue<"started" | "stopped">,
) {
  let starts = 0;
  let stops = 0;
  let running = false;
  let fail = false;
  const commands: unknown[] = [];
  const background = Background.make();
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
      if (receipts) yield* Queue.offer(receipts, "started");
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          stops++;
          running = false;
        }).pipe(Effect.andThen(receipts ? Queue.offer(receipts, "stopped") : Effect.void)),
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
    Layer.succeed(Background.ThreadBackgroundLivenessService, background),
  );
  return {
    layer,
    background,
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
  it.effect("subscribes before activation, ignores history, and applies live settings", () =>
    Effect.gen(function* () {
      const receipts = yield* Queue.unbounded<"started" | "stopped">();
      const events = yield* PubSub.unbounded<OrchestrationEvent>();
      const changes = yield* PubSub.unbounded<ServerSettings>();
      const activation = yield* Deferred.make<void>();
      const h = harness("darwin", true, receipts);
      const engine = Layer.succeed(OrchestrationEngineService, {
        readEvents: () => Stream.die("Must not replay persisted sessions"),
        readThreadEvents: () => Stream.empty,
        getThreadReplayStats: () => Effect.die("Unused"),
        dispatch: () => Effect.die("Unused"),
        streamDomainEvents: Stream.empty,
        subscribeDomainEvents: PubSub.subscribe(events).pipe(Effect.map(Stream.fromSubscription)),
        latestSequence: Effect.succeed(0),
      });
      const settings = Layer.succeed(ServerSettingsService, {
        start: Effect.void,
        ready: Effect.void,
        getSettings: Effect.succeed({ ...DEFAULT_SERVER_SETTINGS, keepAwakeWhileAgentsWork: true }),
        updateSettings: () => Effect.die("Unused"),
        streamChanges: Stream.empty,
        subscribeChanges: PubSub.subscribe(changes).pipe(Effect.map(Stream.fromSubscription)),
      });
      const publish = (event: KeepAwakeEvent, historyImport = false) =>
        PubSub.publish(events, {
          ...event,
          eventId: EventId.make("event"),
          sequence: 1,
          aggregateKind: "thread",
          aggregateId: event.payload.threadId,
          occurredAt: now,
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: { historyImport },
        });
      yield* Layer.build(
        KeepAwakeLayer.pipe(
          Layer.provide(
            Layer.mergeAll(
              h.layer,
              engine,
              settings,
              Layer.succeed(ServerActivation, Deferred.await(activation)),
            ),
          ),
        ),
      );
      yield* publish(session("history", "running"), true);
      yield* publish(session("a", "starting"));
      expect(h.starts()).toBe(0);
      yield* Deferred.succeed(activation, undefined);
      expect(yield* Queue.take(receipts)).toBe("started");
      yield* publish(session("a", "ready"));
      expect(yield* Queue.take(receipts)).toBe("stopped");
      yield* publish(session("b", "running"));
      expect(yield* Queue.take(receipts)).toBe("started");
      yield* PubSub.publish(changes, {
        ...DEFAULT_SERVER_SETTINGS,
        keepAwakeWhileAgentsWork: false,
      });
      expect(yield* Queue.take(receipts)).toBe("stopped");
      expect(h.starts()).toBe(2);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "holds one assertion across overlapping turns and releases it after the last ends",
    () => {
      const h = harness();
      return Effect.gen(function* () {
        const controller = yield* make;
        yield* controller.setEnabled(true);
        expect(h.starts()).toBe(0);
        yield* controller.onEvent(session("a", "starting"));
        yield* controller.onEvent(session("a", "running"));
        yield* controller.onEvent(session("b", "running"));
        expect(h.starts()).toBe(1);
        expect(h.commands[0]).toMatchObject({
          command: "/usr/bin/caffeinate",
          args: ["-i", "-w", String(process.pid)],
        });
        yield* controller.onEvent(session("a", "ready"));
        expect(h.stops()).toBe(0);
        yield* controller.onEvent(session("b", "interrupted"));
        expect(h.stops()).toBe(1);
      }).pipe(Effect.provide(h.layer), Effect.scoped);
    },
  );

  it.effect("applies mid-turn changes, ignores idle sessions, and cleans up on shutdown", () => {
    const h = harness();
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const controller = yield* make;
        yield* controller.onEvent(session("a", "running"));
        expect(h.starts()).toBe(0);
        yield* controller.setEnabled(true);
        expect(h.starts()).toBe(1);
        yield* controller.setEnabled(false);
        expect(h.stops()).toBe(1);
        yield* controller.onEvent(session("a", "ready"));
        yield* controller.setEnabled(true);
        expect(h.starts()).toBe(1);
        yield* controller.onEvent(session("b", "starting"));
      }).pipe(Effect.scoped);
      expect(h.starts()).toBe(2);
      expect(h.stops()).toBe(2);
    }).pipe(Effect.provide(h.layer));
  });

  it.effect("keeps background agents awake after the turn, but excludes monitoring", () => {
    const h = harness();
    return Effect.gen(function* () {
      const controller = yield* make;
      yield* controller.setEnabled(true);
      h.background.recordTaskLiveness({
        threadId: "a",
        taskId: "monitor",
        taskType: "monitor",
        status: "running",
        kind: "started",
      });
      yield* controller.onEvent(activity("a"));
      expect(h.starts()).toBe(0);
      h.background.recordTaskLiveness({
        threadId: "a",
        taskId: "agent",
        taskType: undefined,
        status: "running",
        kind: "started",
      });
      yield* controller.onEvent(activity("a"));
      yield* controller.onEvent(session("a", "ready"));
      expect(h.starts()).toBe(1);
      expect(h.stops()).toBe(0);
      h.background.recordTaskLiveness({
        threadId: "a",
        taskId: "agent",
        taskType: undefined,
        status: "completed",
        kind: "completed",
      });
      yield* controller.onEvent(activity("a"));
      expect(h.stops()).toBe(1);
    }).pipe(Effect.provide(h.layer), Effect.scoped);
  });

  for (const status of ["error", "stopped", "interrupted"] as const) {
    it.effect(`releases a turn on ${status}`, () => {
      const h = harness();
      return Effect.gen(function* () {
        const controller = yield* make;
        yield* controller.setEnabled(true);
        yield* controller.onEvent(session("a", "starting"));
        yield* controller.onEvent(session("a", status));
        expect(h.stops()).toBe(1);
      }).pipe(Effect.provide(h.layer), Effect.scoped);
    });
  }

  it.effect("releases deleted threads and session-owned background work", () => {
    const h = harness();
    return Effect.gen(function* () {
      const controller = yield* make;
      yield* controller.setEnabled(true);
      h.background.recordTaskLiveness({
        threadId: "a",
        taskId: "agent",
        taskType: undefined,
        status: "running",
        kind: "started",
      });
      yield* controller.onEvent(activity("a"));
      yield* controller.onEvent(session("a", "stopped"));
      expect(h.stops()).toBe(1);
      yield* controller.onEvent(session("b", "running"));
      yield* controller.onEvent({
        type: "thread.deleted",
        payload: { threadId: ThreadId.make("b"), deletedAt: now },
      });
      expect(h.stops()).toBe(2);
    }).pipe(Effect.provide(h.layer), Effect.scoped);
  });

  it.effect("recovers from spawn failure and unexpected exit on the next activity change", () => {
    const h = harness();
    return Effect.gen(function* () {
      const controller = yield* make;
      yield* controller.setEnabled(true);
      h.fail(true);
      yield* controller.onEvent(session("a", "starting"));
      expect(h.starts()).toBe(0);
      h.fail(false);
      yield* controller.onEvent(session("a", "running"));
      expect(h.starts()).toBe(1);
      h.crash();
      yield* controller.onEvent(session("b", "running"));
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
        yield* controller.onEvent(session("a", "running"));
        expect(h.starts()).toBe(0);
      }).pipe(Effect.provide(h.layer), Effect.scoped);
    });
  }
});
