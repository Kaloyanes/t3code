import type { OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
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

import * as ThreadManagement from "./orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "./serverActivation.ts";
import { ServerSettingsService } from "./serverSettings.ts";

const CAFFEINATE = "/usr/bin/caffeinate";

export const supportsKeepAwake = Effect.gen(function* () {
  if ((yield* HostProcessPlatform) !== "darwin") return false;
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.exists(CAFFEINATE).pipe(Effect.orElseSucceed(() => false));
});

/** A thread keeps the host awake while a run is active or non-monitor background work is pending. */
export function threadKeepsHostAwake(
  thread: Pick<OrchestrationV2ThreadShell, "activeRunId" | "pendingBackgroundTasks"> | null,
): boolean {
  return (
    thread !== null &&
    (thread.activeRunId !== null ||
      (thread.pendingBackgroundTasks ?? []).some((task) => task.kind !== "monitor"))
  );
}

export const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const supported = yield* supportsKeepAwake;
  const lock = yield* Semaphore.make(1);
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
    if (!supported || !enabled || working.size === 0) {
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
    setThreadWorking: (threadId: ThreadId, isWorking: boolean) =>
      lock.withPermit(
        Effect.gen(function* () {
          if (isWorking) working.add(threadId);
          else working.delete(threadId);
          yield* reconcile;
        }),
      ),
  };
});

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const threads = yield* ThreadManagement.ThreadManagementService;
    const settings = yield* ServerSettingsService;
    const changes = yield* settings.subscribeChanges;
    const controller = yield* make;
    yield* controller.setEnabled((yield* settings.getSettings).keepAwakeWhileAgentsWork);
    // Run and node updates mark every start, finish and background-task change.
    yield* forkParked(
      threads.streamDomainEvents.pipe(
        Stream.filter(
          (event) =>
            event.type === "run.updated" ||
            event.type === "node.updated" ||
            event.type === "thread.deleted",
        ),
        Stream.runForEach((event) =>
          threads.getThreadShell(event.threadId).pipe(
            Effect.orElseSucceed(() => null),
            Effect.flatMap((thread) =>
              controller.setThreadWorking(event.threadId, threadKeepsHostAwake(thread)),
            ),
          ),
        ),
        Effect.ignoreCause({ log: true }),
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
