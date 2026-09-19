// @effect-diagnostics globalDate:off -- SQLite persists ISO instants and the schedule module owns wall-clock resolution.
// @effect-diagnostics preferSchemaOverJson:off -- The validated contract payloads are stored as SQLite text.
import {
  Automation,
  AutomationExecution,
  AutomationId,
  AutomationOperationError,
  AutomationRun,
  AutomationRunId,
  AutomationSchedule,
  AutomationSnapshot,
  AutomationStatus,
  AutomationUpdateInput,
  ProjectId,
  type AutomationCreateInput,
  type AutomationIdInput,
  type AutomationRunIdInput,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlError from "effect/unstable/sql/SqlError";
import * as Schema from "effect/Schema";

import { nextAutomationRun } from "./schedule.ts";

interface AutomationRow {
  readonly automationId: string;
  readonly projectId: string;
  readonly name: string;
  readonly prompt: string;
  readonly scheduleJson: string;
  readonly executionJson: string;
  readonly status: string;
  readonly nextRunAt: string | null;
  readonly lastRunId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface AutomationRunRow {
  readonly runId: string;
  readonly automationId: string;
  readonly projectId: string;
  readonly threadId: string | null;
  readonly trigger: string;
  readonly prompt: string;
  readonly executionJson: string;
  readonly scheduledAt: string;
  readonly status: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly lateByMs: number;
  readonly reason: string | null;
}

export interface AutomationServiceShape {
  readonly getSnapshot: () => Effect.Effect<AutomationSnapshot, AutomationOperationError>;
  readonly create: (
    input: AutomationCreateInput,
  ) => Effect.Effect<AutomationSnapshot, AutomationOperationError>;
  readonly update: (
    input: AutomationUpdateInput,
  ) => Effect.Effect<AutomationSnapshot, AutomationOperationError>;
  readonly pause: (
    input: AutomationIdInput,
  ) => Effect.Effect<AutomationSnapshot, AutomationOperationError>;
  readonly resume: (
    input: AutomationIdInput,
  ) => Effect.Effect<AutomationSnapshot, AutomationOperationError>;
  readonly cancel: (
    input: AutomationIdInput,
  ) => Effect.Effect<AutomationSnapshot, AutomationOperationError>;
  readonly runNow: (
    input: AutomationIdInput,
  ) => Effect.Effect<AutomationSnapshot, AutomationOperationError>;
  readonly retryRun: (
    input: AutomationRunIdInput,
  ) => Effect.Effect<AutomationSnapshot, AutomationOperationError>;
  readonly stopRun: (
    input: AutomationRunIdInput,
  ) => Effect.Effect<AutomationSnapshot, AutomationOperationError>;
}

export class AutomationService extends Context.Service<AutomationService, AutomationServiceShape>()(
  "t3/automation/AutomationService",
) {}

const operationError = (operation: string, detail: string) =>
  new AutomationOperationError({ operation, detail });

const nowIso = (nowMs: number): string => new Date(nowMs).toISOString();

const decodeSchedule = (raw: string): AutomationSchedule =>
  Schema.decodeUnknownSync(AutomationSchedule)(JSON.parse(raw));

const decodeExecution = (raw: string): AutomationExecution =>
  Schema.decodeUnknownSync(AutomationExecution)(JSON.parse(raw));

const decodeAutomation = (row: AutomationRow): Automation => ({
  id: AutomationId.make(row.automationId),
  projectId: ProjectId.make(row.projectId),
  name: row.name,
  prompt: row.prompt,
  schedule: decodeSchedule(row.scheduleJson),
  execution: decodeExecution(row.executionJson),
  status: row.status as AutomationStatus,
  nextRunAt: row.nextRunAt,
  lastRunId: row.lastRunId === null ? null : AutomationRunId.make(row.lastRunId),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const decodeRun = (row: AutomationRunRow): AutomationRun => ({
  id: AutomationRunId.make(row.runId),
  automationId: AutomationId.make(row.automationId),
  projectId: ProjectId.make(row.projectId),
  threadId: row.threadId,
  trigger: row.trigger as AutomationRun["trigger"],
  prompt: row.prompt,
  execution: decodeExecution(row.executionJson),
  scheduledAt: row.scheduledAt,
  status: row.status as AutomationRun["status"],
  startedAt: row.startedAt,
  completedAt: row.completedAt,
  lateByMs: row.lateByMs,
  reason: row.reason,
});

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;

  const failSql = <A>(operation: string, effect: Effect.Effect<A, SqlError.SqlError>) =>
    effect.pipe(
      Effect.mapError(() => operationError(operation, "The automation store is unavailable.")),
    );

  const nextId = (operation: string) =>
    crypto.randomUUIDv4.pipe(
      Effect.mapError(() => operationError(operation, "Could not allocate an automation id.")),
    );

  const decodeAutomationRow = (row: AutomationRow) =>
    Effect.try({
      try: () => decodeAutomation(row),
      catch: () => operationError("read", "Stored automation data is invalid."),
    });
  const decodeRunRow = (row: AutomationRunRow) =>
    Effect.try({
      try: () => decodeRun(row),
      catch: () => operationError("read", "Stored automation run data is invalid."),
    });

  const listAutomations = failSql(
    "list",
    sql<AutomationRow>`
      SELECT
        automation_id AS "automationId",
        project_id AS "projectId",
        name,
        prompt,
        schedule_json AS "scheduleJson",
        execution_json AS "executionJson",
        status,
        next_run_at AS "nextRunAt",
        last_run_id AS "lastRunId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM projection_automations
      ORDER BY status = 'active' DESC, next_run_at ASC, name COLLATE NOCASE ASC
    `,
  );
  const listRuns = failSql(
    "list",
    sql<AutomationRunRow>`
      SELECT
        run_id AS "runId",
        automation_id AS "automationId",
        project_id AS "projectId",
        thread_id AS "threadId",
        trigger,
        prompt,
        execution_json AS "executionJson",
        scheduled_at AS "scheduledAt",
        status,
        started_at AS "startedAt",
        completed_at AS "completedAt",
        late_by_ms AS "lateByMs",
        reason
      FROM projection_automation_runs
      ORDER BY scheduled_at DESC
      LIMIT 200
    `,
  );

  const getSnapshot: AutomationServiceShape["getSnapshot"] = () =>
    Effect.gen(function* () {
      const [automationRows, runRows] = yield* Effect.all([listAutomations, listRuns]);
      return {
        automations: yield* Effect.forEach(automationRows, decodeAutomationRow),
        runs: yield* Effect.forEach(runRows, decodeRunRow),
      };
    });

  const getAutomation = (id: AutomationId) =>
    failSql(
      "read",
      sql<AutomationRow>`
        SELECT
          automation_id AS "automationId", project_id AS "projectId", name, prompt,
          schedule_json AS "scheduleJson", execution_json AS "executionJson", status,
          next_run_at AS "nextRunAt", last_run_id AS "lastRunId",
          created_at AS "createdAt", updated_at AS "updatedAt"
        FROM projection_automations WHERE automation_id = ${id} LIMIT 1
      `,
    ).pipe(
      Effect.flatMap((rows) => {
        const row = rows[0];
        return row === undefined
          ? Effect.fail(operationError("read", "Automation not found."))
          : decodeAutomationRow(row);
      }),
    );

  const getRun = (id: AutomationRunId) =>
    failSql(
      "read",
      sql<AutomationRunRow>`
        SELECT
          run_id AS "runId", automation_id AS "automationId", project_id AS "projectId",
          thread_id AS "threadId", trigger, prompt, execution_json AS "executionJson",
          scheduled_at AS "scheduledAt", status, started_at AS "startedAt",
          completed_at AS "completedAt", late_by_ms AS "lateByMs", reason
        FROM projection_automation_runs WHERE run_id = ${id} LIMIT 1
      `,
    ).pipe(
      Effect.flatMap((rows) => {
        const row = rows[0];
        return row === undefined
          ? Effect.fail(operationError("read", "Automation run not found."))
          : decodeRunRow(row);
      }),
    );

  const nextRunAt = (schedule: AutomationSchedule, nowMs: number) =>
    Effect.try({
      try: () => nextAutomationRun(schedule, nowMs),
      catch: (cause) =>
        operationError("schedule", cause instanceof Error ? cause.message : "Invalid schedule."),
    });

  const create: AutomationServiceShape["create"] = (input) =>
    Effect.gen(function* () {
      const nowMs = yield* Clock.currentTimeMillis;
      const createdAt = nowIso(nowMs);
      const id = AutomationId.make(yield* nextId("create"));
      const next = yield* nextRunAt(input.schedule, nowMs);
      yield* failSql(
        "create",
        sql`
          INSERT INTO projection_automations (
            automation_id, project_id, name, prompt, schedule_json, execution_json,
            status, next_run_at, last_run_id, created_at, updated_at
          ) VALUES (
            ${id}, ${input.projectId}, ${input.name}, ${input.prompt},
            ${JSON.stringify(input.schedule)}, ${JSON.stringify(input.execution)},
            'active', ${next}, NULL, ${createdAt}, ${createdAt}
          )
        `,
      );
      return yield* getSnapshot();
    });

  const update: AutomationServiceShape["update"] = (input) =>
    Effect.gen(function* () {
      const current = yield* getAutomation(input.id);
      const nowMs = yield* Clock.currentTimeMillis;
      const next = current.status === "active" ? yield* nextRunAt(input.schedule, nowMs) : null;
      yield* failSql(
        "update",
        sql`
          UPDATE projection_automations SET
            name = ${input.name}, prompt = ${input.prompt},
            schedule_json = ${JSON.stringify(input.schedule)},
            execution_json = ${JSON.stringify(input.execution)},
            next_run_at = ${next}, updated_at = ${nowIso(nowMs)}
          WHERE automation_id = ${input.id}
        `,
      );
      return yield* getSnapshot();
    });

  const setStatus = (input: AutomationIdInput, status: AutomationStatus) =>
    Effect.gen(function* () {
      const current = yield* getAutomation(input.id);
      const nowMs = yield* Clock.currentTimeMillis;
      const next = status === "active" ? yield* nextRunAt(current.schedule, nowMs) : null;
      yield* failSql(
        status === "canceled" ? "cancel" : status === "paused" ? "pause" : "resume",
        sql`
          UPDATE projection_automations
          SET status = ${status}, next_run_at = ${next}, updated_at = ${nowIso(nowMs)}
          WHERE automation_id = ${input.id}
        `,
      );
      if (status === "canceled") {
        yield* failSql(
          "cancel",
          sql`
            UPDATE projection_automation_runs
            SET status = 'canceled', completed_at = ${nowIso(nowMs)}, reason = 'Automation canceled'
            WHERE automation_id = ${input.id} AND status = 'scheduled' AND trigger = 'schedule'
          `,
        );
      }
      return yield* getSnapshot();
    });

  const runNow: AutomationServiceShape["runNow"] = (input) =>
    Effect.gen(function* () {
      const automation = yield* getAutomation(input.id);
      if (automation.status === "canceled") {
        return yield* Effect.fail(operationError("run now", "Canceled automations cannot be run."));
      }
      const nowMs = yield* Clock.currentTimeMillis;
      const runId = AutomationRunId.make(yield* nextId("run now"));
      yield* failSql(
        "run now",
        sql`
          INSERT INTO projection_automation_runs (
            run_id, automation_id, project_id, thread_id, trigger, prompt,
            execution_json, scheduled_at, status, started_at, completed_at,
            late_by_ms, reason, worktree_path
          ) VALUES (
            ${runId}, ${automation.id}, ${automation.projectId}, NULL, 'manual', ${automation.prompt},
            ${JSON.stringify(automation.execution)}, ${nowIso(nowMs)}, 'scheduled', NULL, NULL,
            0, NULL, NULL
          )
        `,
      );
      return yield* getSnapshot();
    });

  const retryRun: AutomationServiceShape["retryRun"] = (input) =>
    Effect.gen(function* () {
      const failedRun = yield* getRun(input.id);
      if (failedRun.status !== "failed") {
        return yield* Effect.fail(operationError("retry", "Only failed runs can be retried."));
      }
      const automation = yield* getAutomation(failedRun.automationId);
      if (automation.status === "canceled") {
        return yield* Effect.fail(
          operationError("retry", "Canceled automations cannot be retried."),
        );
      }
      const nowMs = yield* Clock.currentTimeMillis;
      const runId = AutomationRunId.make(yield* nextId("retry"));
      yield* failSql(
        "retry",
        sql`
          INSERT INTO projection_automation_runs (
            run_id, automation_id, project_id, thread_id, trigger, prompt,
            execution_json, scheduled_at, status, started_at, completed_at,
            late_by_ms, reason, worktree_path
          ) VALUES (
            ${runId}, ${failedRun.automationId}, ${failedRun.projectId}, NULL, 'retry',
            ${failedRun.prompt}, ${JSON.stringify(failedRun.execution)}, ${nowIso(nowMs)},
            'scheduled', NULL, NULL, 0, NULL, NULL
          )
        `,
      );
      return yield* getSnapshot();
    });

  const stopRun: AutomationServiceShape["stopRun"] = (input) =>
    Effect.gen(function* () {
      const run = yield* getRun(input.id);
      if (!["scheduled", "running", "waiting-for-input"].includes(run.status)) {
        return yield* Effect.fail(operationError("stop", "This run is no longer active."));
      }
      const nowMs = yield* Clock.currentTimeMillis;
      yield* failSql(
        "stop",
        sql`
          UPDATE projection_automation_runs
          SET status = 'canceled', completed_at = ${nowIso(nowMs)}, reason = 'Stopped by user'
          WHERE run_id = ${input.id}
        `,
      );
      return yield* getSnapshot();
    });

  return AutomationService.of({
    getSnapshot,
    create,
    update,
    pause: (input) => setStatus(input, "paused"),
    resume: (input) => setStatus(input, "active"),
    cancel: (input) => setStatus(input, "canceled"),
    runNow,
    retryRun,
    stopRun,
  });
});

export const layer = Layer.effect(AutomationService, make);
