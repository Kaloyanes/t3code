// @effect-diagnostics globalDate:off globalDateInEffect:off runEffectInsideEffect:off outdatedApi:off nodeBuiltinImport:off
import type {
  WorktreeRunAttachEvent,
  WorktreeRunMetadataEvent,
  WorktreeRunResizeInput,
  WorktreeRunSnapshot,
  WorktreeRunStartInput,
  WorktreeRunSummary,
  WorktreeRunTarget,
  WorktreeRunWriteInput,
} from "@t3tools/contracts";
import { WorktreeRunError } from "@t3tools/contracts";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as NodePath from "node:path";

import * as PtyAdapter from "../terminal/PtyAdapter.ts";

interface StartSpec {
  readonly input: WorktreeRunStartInput;
  readonly name: string;
  readonly command: string;
  readonly projectRoot: string;
}

interface Session {
  readonly target: WorktreeRunTarget;
  readonly name: string;
  readonly command: string;
  readonly process: PtyAdapter.PtyProcess;
  status: WorktreeRunSnapshot["status"];
  history: string;
  exitCode: number | null;
  exitSignal: number | null;
  updatedAt: string;
  readonly exited: Deferred.Deferred<void>;
}

const keyOf = (target: WorktreeRunTarget) =>
  JSON.stringify([target.projectId, target.workspacePath, target.scriptId]);
const sameTarget = (left: WorktreeRunTarget, right: WorktreeRunTarget) =>
  keyOf(left) === keyOf(right);
const trimHistory = (history: string) => history.slice(-1_048_576);

export class WorktreeRunManager extends Context.Service<
  WorktreeRunManager,
  {
    readonly start: (spec: StartSpec) => Effect.Effect<WorktreeRunSnapshot, WorktreeRunError>;
    readonly write: (input: WorktreeRunWriteInput) => Effect.Effect<void, WorktreeRunError>;
    readonly resize: (input: WorktreeRunResizeInput) => Effect.Effect<void, WorktreeRunError>;
    readonly clear: (target: WorktreeRunTarget) => Effect.Effect<void, WorktreeRunError>;
    readonly stop: (target: WorktreeRunTarget) => Effect.Effect<void, WorktreeRunError>;
    readonly stopWorkspace: (workspacePath: string) => Effect.Effect<void>;
    readonly stopProject: (projectId: string) => Effect.Effect<void>;
    readonly attach: (
      target: WorktreeRunTarget,
      listener: (event: WorktreeRunAttachEvent) => Effect.Effect<void>,
    ) => Effect.Effect<() => void, WorktreeRunError>;
    readonly subscribeMetadata: (
      listener: (event: WorktreeRunMetadataEvent) => Effect.Effect<void>,
    ) => Effect.Effect<() => void>;
    readonly shutdown: Effect.Effect<void>;
  }
>()("t3/worktreeRun/Manager/WorktreeRunManager") {}

const make = Effect.gen(function* () {
  const pty = yield* PtyAdapter.PtyAdapter;
  const platform = yield* HostProcessPlatform;
  const processEnvironment = yield* HostProcessEnvironment;
  const lock = yield* Semaphore.make(1);
  const sessions = new Map<string, Session>();
  const attachListeners = new Set<{
    target: WorktreeRunTarget;
    listener: (event: WorktreeRunAttachEvent) => Effect.Effect<void>;
  }>();
  const metadataListeners = new Set<(event: WorktreeRunMetadataEvent) => Effect.Effect<void>>();
  const runFork = Effect.runFork;

  const snapshot = (session: Session): WorktreeRunSnapshot => ({
    target: session.target,
    name: session.name,
    command: session.command,
    status: session.status,
    pid: session.status === "running" ? session.process.pid : null,
    history: session.history,
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    label: session.name,
    updatedAt: session.updatedAt,
  });
  const summary = (session: Session): WorktreeRunSummary => {
    const { history: _history, ...value } = snapshot(session);
    return value;
  };
  const publishMetadata = (session: Session) =>
    Effect.forEach(metadataListeners, (listener) =>
      listener({ type: "upsert", run: summary(session) }),
    ).pipe(Effect.ignore);
  const publishAttach = (target: WorktreeRunTarget, event: WorktreeRunAttachEvent) =>
    Effect.forEach(
      [...attachListeners].filter((entry) => sameTarget(entry.target, target)),
      (entry) => entry.listener(event),
    ).pipe(Effect.ignore);

  const start = (spec: StartSpec) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const target: WorktreeRunTarget = {
          projectId: spec.input.projectId,
          workspacePath: spec.input.workspacePath,
          scriptId: spec.input.scriptId,
        };
        const key = keyOf(target);
        const existing = sessions.get(key);
        if (existing?.status === "running" || existing?.status === "starting") {
          return snapshot(existing);
        }
        const shell =
          platform === "win32"
            ? (processEnvironment.ComSpec ?? "cmd.exe")
            : (processEnvironment.SHELL ?? "/bin/sh");
        const args =
          platform === "win32" ? ["/d", "/s", "/c", spec.command] : ["-lc", spec.command];
        const spawned = yield* pty
          .spawn({
            shell,
            args,
            cwd: spec.input.workspacePath,
            cols: spec.input.cols ?? 120,
            rows: spec.input.rows ?? 30,
            env: {
              ...processEnvironment,
              TERM: processEnvironment.TERM ?? "xterm-256color",
              COLORTERM: processEnvironment.COLORTERM ?? "truecolor",
              T3CODE_PROJECT_ROOT: spec.projectRoot,
              ...(spec.input.workspacePath === spec.projectRoot
                ? {}
                : { T3CODE_WORKTREE_PATH: spec.input.workspacePath }),
            },
          })
          .pipe(
            Effect.mapError(
              (error) => new WorktreeRunError({ operation: "start", message: error.message }),
            ),
          );
        const exited = yield* Deferred.make<void>();
        const session: Session = {
          target,
          name: spec.name,
          command: spec.command,
          process: spawned,
          status: "running",
          history: "",
          exitCode: null,
          exitSignal: null,
          updatedAt: new Date().toISOString(),
          exited,
        };
        sessions.set(key, session);
        spawned.onData((data) => {
          if (sessions.get(key) !== session) return;
          session.history = trimHistory(session.history + data);
          session.updatedAt = new Date().toISOString();
          runFork(publishAttach(target, { type: "output", target, data }));
        });
        spawned.onExit((event) => {
          if (sessions.get(key) !== session) return;
          if (session.status !== "stopped") session.status = "exited";
          session.exitCode = event.exitCode;
          session.exitSignal = event.signal;
          session.updatedAt = new Date().toISOString();
          runFork(
            Effect.all([
              Deferred.succeed(session.exited, undefined),
              publishAttach(target, {
                type: "exited",
                target,
                exitCode: event.exitCode,
                exitSignal: event.signal,
              }),
              publishMetadata(session),
            ]).pipe(Effect.ignore),
          );
        });
        yield* publishMetadata(session);
        return snapshot(session);
      }),
    );

  const requireSession = (target: WorktreeRunTarget, operation: string) =>
    Effect.suspend(() => {
      const session = sessions.get(keyOf(target));
      return session
        ? Effect.succeed(session)
        : Effect.fail(
            new WorktreeRunError({ operation, message: "Worktree action is not running." }),
          );
    });
  const write = (input: WorktreeRunWriteInput) =>
    requireSession(input, "write").pipe(
      Effect.flatMap((session) =>
        Effect.try({
          try: () => session.process.write(input.data),
          catch: (error) => new WorktreeRunError({ operation: "write", message: String(error) }),
        }),
      ),
    );
  const resize = (input: WorktreeRunResizeInput) =>
    requireSession(input, "resize").pipe(
      Effect.flatMap((session) =>
        Effect.try({
          try: () => session.process.resize(input.cols, input.rows),
          catch: (error) => new WorktreeRunError({ operation: "resize", message: String(error) }),
        }),
      ),
    );
  const clear = (target: WorktreeRunTarget) =>
    requireSession(target, "clear").pipe(
      Effect.tap((session) =>
        Effect.sync(() => {
          session.history = "";
          session.updatedAt = new Date().toISOString();
        }),
      ),
      Effect.tap(() => publishAttach(target, { type: "cleared", target })),
      Effect.asVoid,
    );
  const stop = (target: WorktreeRunTarget) =>
    requireSession(target, "stop").pipe(
      Effect.tap((session) =>
        session.status !== "running" && session.status !== "starting"
          ? Effect.void
          : Effect.gen(function* () {
              session.status = "stopped";
              session.updatedAt = new Date().toISOString();
              yield* Effect.try(() => session.process.kill("SIGTERM")).pipe(Effect.ignore);
              yield* publishMetadata(session);
              yield* Deferred.await(session.exited).pipe(
                Effect.timeoutOrElse({
                  duration: "2 seconds",
                  orElse: () =>
                    Effect.try(() => session.process.kill("SIGKILL")).pipe(Effect.ignore),
                }),
              );
            }),
      ),
      Effect.tap(() => publishAttach(target, { type: "stopped", target })),
      Effect.asVoid,
    );
  const stopMatching = (predicate: (session: Session) => boolean) =>
    Effect.forEach(
      [...sessions.values()].filter(predicate),
      (session) => stop(session.target).pipe(Effect.ignore),
      { discard: true },
    );
  const attach = (
    target: WorktreeRunTarget,
    listener: (event: WorktreeRunAttachEvent) => Effect.Effect<void>,
  ) =>
    requireSession(target, "attach").pipe(
      Effect.flatMap((session) => listener({ type: "snapshot", snapshot: snapshot(session) })),
      Effect.map(() => {
        const entry = { target, listener };
        attachListeners.add(entry);
        return () => attachListeners.delete(entry);
      }),
    );
  const subscribeMetadata = (listener: (event: WorktreeRunMetadataEvent) => Effect.Effect<void>) =>
    listener({ type: "snapshot", runs: [...sessions.values()].map(summary) }).pipe(
      Effect.map(() => {
        metadataListeners.add(listener);
        return () => metadataListeners.delete(listener);
      }),
    );
  const shutdown = stopMatching(() => true);

  yield* Effect.addFinalizer(() => shutdown);

  return WorktreeRunManager.of({
    start,
    write,
    resize,
    clear,
    stop,
    stopWorkspace: (workspacePath) =>
      stopMatching(
        (session) =>
          NodePath.resolve(session.target.workspacePath) === NodePath.resolve(workspacePath),
      ),
    stopProject: (projectId) => stopMatching((session) => session.target.projectId === projectId),
    attach,
    subscribeMetadata,
    shutdown,
  });
});

export const layer = Layer.effect(WorktreeRunManager, make);
