import type { OrchestrationEvent } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { ThreadBackgroundLivenessService } from "./orchestration/ThreadBackgroundLiveness.ts";
import { forkParked } from "./serverActivation.ts";
import { ServerSettingsService } from "./serverSettings.ts";

const CAFFEINATE = "/usr/bin/caffeinate";

export const supportsKeepAwake = Effect.gen(function* () {
  if ((yield* HostProcessPlatform) !== "darwin") return false;
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.exists(CAFFEINATE).pipe(Effect.orElseSucceed(() => false));
});

type ActivityEvent = Extract<
  OrchestrationEvent,
  { type: "thread.session-set" | "thread.activity-appended" | "thread.deleted" }
>;
export type KeepAwakeEvent = {
  [Type in ActivityEvent["type"]]: Pick<Extract<ActivityEvent, { type: Type }>, "type" | "payload">;
}[ActivityEvent["type"]];

export const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const background = yield* ThreadBackgroundLivenessService;
  const supported = yield* supportsKeepAwake;
  const lock = yield* Semaphore.make(1);
  const active = new Set<string>();
  const working = new Set<string>();
  let enabled = false;
  let child: { scope: Scope.Closeable; handle: ChildProcessSpawner.ChildProcessHandle } | undefined;

  const stop = Effect.gen(function* () {
    const previous = child;
    child = undefined;
    if (previous) yield* Scope.close(previous.scope, Exit.void);
  });
  yield* Effect.addFinalizer(() => stop);

  const reconcile = Effect.gen(function* () {
    if (!supported || !enabled || (active.size === 0 && working.size === 0)) {
      yield* stop;
      return;
    }
    if (child && (yield* child.handle.isRunning)) return;
    yield* stop;
    const scope = yield* Scope.make();
    const result = yield* spawner
      .spawn(
        ChildProcess.make(CAFFEINATE, ["-i", "-w", String(process.pid)], {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        }),
      )
      .pipe(Effect.provideService(Scope.Scope, scope), Effect.exit);
    if (Exit.isFailure(result)) {
      yield* Scope.close(scope, Exit.void);
      yield* Effect.logWarning("Could not keep the computer awake", { cause: result.cause });
      return;
    }
    child = { scope, handle: result.value };
    yield* result.value.exitCode.pipe(
      Effect.flatMap((code) => Effect.logWarning("Keep-awake process exited", { code })),
      Effect.ignoreCause({ log: true }),
      Effect.forkIn(scope),
    );
  }).pipe(Effect.ignoreCause({ log: true }));

  return {
    setEnabled: (value: boolean) =>
      lock.withPermit(
        Effect.gen(function* () {
          enabled = value;
          yield* reconcile;
        }),
      ),
    onEvent: (event: KeepAwakeEvent) =>
      lock.withPermit(
        Effect.gen(function* () {
          const id = event.payload.threadId;
          if (event.type === "thread.deleted") {
            active.delete(id);
            working.delete(id);
          } else {
            if (event.type === "thread.session-set") {
              const status = event.payload.session.status;
              if (status === "starting" || status === "running") active.add(id);
              else active.delete(id);
              if (status === "stopped" || status === "error") working.delete(id);
            }
            if (event.type === "thread.activity-appended") {
              if (background.getThreadBackgroundLiveness(id) === "working") working.add(id);
              else working.delete(id);
            }
          }
          yield* reconcile;
        }),
      ),
  };
});

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    const settings = yield* ServerSettingsService;
    // Subscribe before activation; historical sessions are deliberately not replayed.
    const events = yield* engine.subscribeDomainEvents;
    const changes = yield* settings.subscribeChanges;
    const controller = yield* make;
    yield* controller.setEnabled((yield* settings.getSettings).keepAwakeWhileAgentsWork);
    yield* forkParked(
      events.pipe(
        Stream.filter((event) => event.metadata.historyImport !== true),
        Stream.filter(
          (event): event is ActivityEvent =>
            event.type === "thread.session-set" ||
            event.type === "thread.deleted" ||
            (event.type === "thread.activity-appended" &&
              event.payload.activity.kind.startsWith("task.")),
        ),
        Stream.runForEach(controller.onEvent),
      ),
    );
    yield* forkParked(
      changes.pipe(
        Stream.map((value) => value.keepAwakeWhileAgentsWork),
        Stream.changes,
        Stream.runForEach(controller.setEnabled),
      ),
    );
  }),
);
