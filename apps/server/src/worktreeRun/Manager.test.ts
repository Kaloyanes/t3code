import { describe, expect, it } from "@effect/vitest";
import { ProjectId, type WorktreeRunAttachEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as PtyAdapter from "../terminal/PtyAdapter.ts";
import * as WorktreeRunManager from "./Manager.ts";

class FakeProcess implements PtyAdapter.PtyProcess {
  readonly pid: number;
  readonly writes: string[] = [];
  readonly sizes: Array<readonly [number, number]> = [];
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: PtyAdapter.PtyExitEvent) => void>();

  constructor(pid: number) {
    this.pid = pid;
  }

  write(data: string) {
    this.writes.push(data);
  }

  resize(cols: number, rows: number) {
    this.sizes.push([cols, rows]);
  }

  kill() {
    this.exit(0, 15);
  }

  onData(listener: (data: string) => void) {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onExit(listener: (event: PtyAdapter.PtyExitEvent) => void) {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  output(data: string) {
    for (const listener of this.dataListeners) listener(data);
  }

  exit(exitCode = 0, signal: number | null = null) {
    for (const listener of this.exitListeners) listener({ exitCode, signal });
  }
}

const makeLayer = (processes: FakeProcess[]) =>
  WorktreeRunManager.layer.pipe(
    Layer.provide(
      Layer.succeed(PtyAdapter.PtyAdapter, {
        spawn: () =>
          Effect.sync(() => {
            const process = new FakeProcess(100 + processes.length);
            processes.push(process);
            return process;
          }),
      }),
    ),
  );

const projectId = ProjectId.make("project-1");
const target = { projectId, workspacePath: "/repo/worktrees/a", scriptId: "dev" } as const;
const startSpec = {
  input: target,
  name: "Dev",
  command: "pnpm dev",
  projectRoot: "/repo",
} as const;

describe("WorktreeRunManager", () => {
  it.effect("owns one process per target and starts fresh after exit", () => {
    const processes: FakeProcess[] = [];
    return Effect.gen(function* () {
      const manager = yield* WorktreeRunManager.WorktreeRunManager;
      const [first, second] = yield* Effect.all(
        [manager.start(startSpec), manager.start(startSpec)],
        {
          concurrency: "unbounded",
        },
      );
      expect(first.pid).toBe(second.pid);
      expect(processes).toHaveLength(1);

      processes[0]?.exit(0);
      yield* Effect.yieldNow;
      const restarted = yield* manager.start(startSpec);
      expect(restarted.pid).not.toBe(first.pid);
      expect(processes).toHaveLength(2);
    }).pipe(Effect.provide(makeLayer(processes)));
  });

  it.effect("attaches interactively and clears retained output", () => {
    const processes: FakeProcess[] = [];
    return Effect.gen(function* () {
      const manager = yield* WorktreeRunManager.WorktreeRunManager;
      yield* manager.start(startSpec);
      const events = yield* Ref.make<ReadonlyArray<WorktreeRunAttachEvent>>([]);
      const detach = yield* manager.attach(target, (event) =>
        Ref.update(events, (current) => [...current, event]),
      );
      yield* manager.write({ ...target, data: "status\r" });
      yield* manager.resize({ ...target, cols: 90, rows: 24 });
      processes[0]?.output("ready\r\n");
      yield* Effect.yieldNow;
      yield* manager.clear(target);
      detach();

      expect(processes[0]?.writes).toEqual(["status\r"]);
      expect(processes[0]?.sizes).toEqual([[90, 24]]);
      expect((yield* Ref.get(events)).map((event) => event.type)).toEqual([
        "snapshot",
        "output",
        "cleared",
      ]);
    }).pipe(Effect.provide(makeLayer(processes)));
  });

  it.effect("runs different actions and worktrees independently", () => {
    const processes: FakeProcess[] = [];
    return Effect.gen(function* () {
      const manager = yield* WorktreeRunManager.WorktreeRunManager;
      const runs = yield* Effect.all([
        manager.start(startSpec),
        manager.start({
          ...startSpec,
          input: { ...target, scriptId: "test" },
          name: "Test",
          command: "pnpm test --watch",
        }),
        manager.start({
          ...startSpec,
          input: { ...target, workspacePath: "/repo/worktrees/b" },
        }),
      ]);

      expect(new Set(runs.map((run) => run.pid)).size).toBe(3);
      expect(processes).toHaveLength(3);
    }).pipe(Effect.provide(makeLayer(processes)));
  });
});
