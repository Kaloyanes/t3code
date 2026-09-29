// @effect-diagnostics globalDate:off -- SQLite stores UTC instants; Clock supplies the current time.
// @effect-diagnostics preferSchemaOverJson:off -- Validated execution settings are stored as JSON text.
import {
  CommandId,
  MessageId,
  ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
  UsageResume,
  UsageResumeError,
  type UsageResumeSnapshot,
  type UsageResumeScheduleInput,
  type UsageResumeCancelInput,
  type ServerProvider,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { OrchestrationCommandReceiptRepository } from "../persistence/Services/OrchestrationCommandReceipts.ts";
import { usageResumeEligibility } from "./usageResumeEligibility.ts";

const Execution = Schema.Struct({
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
});
interface Row {
  readonly thread_id: string;
  readonly id: string;
  readonly prompt: string;
  readonly scheduled_at: string;
  readonly status: string;
  readonly reason: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly execution_json: string;
  readonly baseline_message_at: string | null;
  readonly auth_identity: string;
  readonly probe_failures: number;
}
const decodeResume = Schema.decodeUnknownSync(UsageResume);
const decodeExecution = Schema.decodeEffect(Schema.fromJsonString(Execution));
const isUsageResumeError = Schema.is(UsageResumeError);
const decode = (row: Row) =>
  decodeResume({
    id: row.id,
    threadId: row.thread_id,
    prompt: row.prompt,
    scheduledAt: row.scheduled_at,
    status: row.status,
    reason: row.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
const identity = (provider: ServerProvider) => JSON.stringify(provider.auth);
const iso = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));
const commandId = (id: string) => CommandId.make(`server:usage-resume:${id}`);
const fail = (detail: string) => new UsageResumeError({ detail });
const mapError = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError((error) =>
      isUsageResumeError(error)
        ? error
        : fail("The usage resume operation failed. Please try again."),
    ),
  );

export class UsageResumeService extends Context.Service<
  UsageResumeService,
  {
    readonly get: (threadId: ThreadId) => Effect.Effect<UsageResumeSnapshot, UsageResumeError>;
    readonly schedule: (
      input: UsageResumeScheduleInput,
    ) => Effect.Effect<UsageResumeSnapshot, UsageResumeError>;
    readonly cancel: (
      input: UsageResumeCancelInput,
    ) => Effect.Effect<UsageResumeSnapshot, UsageResumeError>;
    readonly subscribe: (
      threadId: ThreadId,
    ) => Stream.Stream<UsageResumeSnapshot, UsageResumeError>;
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly tick: () => Effect.Effect<void, UsageResumeError>;
  }
>()("t3/automation/UsageResumeService") {}

export const layer = Layer.effect(
  UsageResumeService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const crypto = yield* Crypto.Crypto;
    const snapshots = yield* ProjectionSnapshotQuery;
    const providers = yield* ProviderRegistry;
    const engine = yield* OrchestrationEngineService;
    const receipts = yield* OrchestrationCommandReceiptRepository;
    const changes = yield* PubSub.unbounded<ThreadId>();
    const wake = yield* Queue.sliding<void>(1);
    const notify = (threadId: ThreadId) =>
      PubSub.publish(changes, threadId).pipe(
        Effect.andThen(Queue.offer(wake, undefined)),
        Effect.asVoid,
      );
    const rows = (threadId: ThreadId) =>
      sql<Row>`SELECT * FROM usage_resumes WHERE thread_id = ${threadId}`;
    const revision = (threadId: ThreadId) =>
      sql<{
        readonly sequence: number;
      }>`SELECT COALESCE(MAX(sequence), 0) AS sequence FROM orchestration_events WHERE aggregate_kind='thread' AND stream_id=${threadId}`.pipe(
        Effect.map((rows) => rows[0]!.sequence),
      );
    const get = (threadId: ThreadId) =>
      mapError(
        Effect.gen(function* () {
          const [stored, thread, list, now] = yield* Effect.all([
            rows(threadId),
            snapshots.getThreadShellById(threadId),
            providers.getProviders,
            Clock.currentTimeMillis,
          ]);
          const shell = Option.getOrUndefined(thread);
          return {
            threadId,
            eligibility: usageResumeEligibility(
              shell,
              list.find((provider) => provider.instanceId === shell?.modelSelection.instanceId),
              now,
            ),
            schedule: stored[0] ? decode(stored[0]) : null,
          };
        }),
      );
    const schedule = (input: UsageResumeScheduleInput) =>
      mapError(
        Effect.gen(function* () {
          const beforeProbe = yield* revision(input.threadId);
          const original = yield* snapshots.getThreadShellById(input.threadId);
          if (Option.isNone(original)) return yield* fail("The thread no longer exists.");
          const probeAt = yield* Clock.currentTimeMillis;
          const list = yield* providers.refreshInstance(original.value.modelSelection.instanceId);
          const provider = list.find(
            (entry) => entry.instanceId === original.value.modelSelection.instanceId,
          );
          if (!provider?.usageLimits || Date.parse(provider.usageLimits.checkedAt) < probeAt)
            return yield* fail("Provider usage could not be refreshed. Try again.");
          const id = yield* crypto.randomUUIDv4;
          yield* sql.withTransaction(
            Effect.gen(function* () {
              if ((yield* revision(input.threadId)) !== beforeProbe)
                return yield* fail("The thread changed while checking usage. Try again.");
              const thread = yield* snapshots.getThreadShellById(input.threadId);
              if (Option.isNone(thread)) return yield* fail("The thread no longer exists.");
              const now = yield* Clock.currentTimeMillis;
              const eligibility = usageResumeEligibility(thread.value, provider, now);
              if (!eligibility.available || !eligibility.resetsAt || !provider)
                return yield* fail(
                  eligibility.reason ?? "This thread has not stopped at a supported usage limit.",
                );
              if (
                thread.value.modelSelection.instanceId !== original.value.modelSelection.instanceId
              )
                return yield* fail("The thread provider changed. Try again.");
              const existing = (yield* rows(input.threadId))[0];
              if (existing?.status === "pending" || existing?.status === "dispatching")
                return yield* fail("This thread already has a scheduled resume.");
              const at = iso(now);
              const execution = {
                modelSelection: thread.value.modelSelection,
                runtimeMode: thread.value.runtimeMode,
                interactionMode: thread.value.interactionMode,
              };
              yield* sql`INSERT INTO usage_resumes (thread_id, id, prompt, scheduled_at, status, reason, created_at, updated_at, execution_json, baseline_message_at, auth_identity, probe_failures)
        VALUES (${input.threadId}, ${id}, ${input.prompt}, ${eligibility.resetsAt}, 'pending', NULL, ${at}, ${at}, ${JSON.stringify(execution)}, ${thread.value.latestUserMessageAt}, ${identity(provider)}, 0)
        ON CONFLICT(thread_id) DO UPDATE SET id=excluded.id, prompt=excluded.prompt, scheduled_at=excluded.scheduled_at, status='pending', reason=NULL, created_at=excluded.created_at, updated_at=excluded.updated_at, execution_json=excluded.execution_json, baseline_message_at=excluded.baseline_message_at, auth_identity=excluded.auth_identity, probe_failures=0`;
            }),
          );
          yield* notify(input.threadId);
          return yield* get(input.threadId);
        }),
      );
    const cancel = (input: UsageResumeCancelInput) =>
      mapError(
        Effect.gen(function* () {
          const row = (yield* rows(input.threadId))[0];
          if (row?.id !== input.id)
            return yield* fail("This scheduled resume has changed. Refresh the thread.");
          if (row.status === "dispatching" || row.status === "dispatched")
            return yield* fail("Dispatch has already started. Use Stop to interrupt the turn.");
          if (row.status !== "pending") return yield* get(input.threadId);
          const canceled =
            yield* sql<Row>`UPDATE usage_resumes SET status='canceled', reason='Canceled by you.', updated_at=${iso(yield* Clock.currentTimeMillis)} WHERE id=${input.id} AND status='pending' RETURNING *`;
          if (!canceled.length)
            return yield* fail("Dispatch has already started. Use Stop to interrupt the turn.");
          yield* notify(input.threadId);
          return yield* get(input.threadId);
        }),
      );
    const update = (
      row: Row,
      status: UsageResume["status"],
      reason: string | null,
      scheduledAt = row.scheduled_at,
      failures = row.probe_failures,
    ) =>
      Effect.gen(function* () {
        yield* sql`UPDATE usage_resumes SET status=${status}, reason=${reason}, scheduled_at=${scheduledAt}, probe_failures=${failures}, updated_at=${iso(yield* Clock.currentTimeMillis)} WHERE id=${row.id} AND status IN ('pending', 'dispatching')`;
        yield* notify(ThreadId.make(row.thread_id));
      });
    const dispatch = (row: Row) =>
      Effect.gen(function* () {
        const threadId = ThreadId.make(row.thread_id);
        const execution = yield* decodeExecution(row.execution_json);
        const thread = yield* snapshots.getThreadShellById(threadId);
        if (
          Option.isNone(thread) ||
          thread.value.archivedAt ||
          thread.value.latestUserMessageAt !== row.baseline_message_at ||
          JSON.stringify(thread.value.modelSelection) !== JSON.stringify(execution.modelSelection)
        ) {
          yield* update(row, "canceled", "The thread changed after this resume was scheduled.");
          return;
        }
        if (
          thread.value.session?.activeTurnId ||
          thread.value.latestTurn?.state === "running" ||
          thread.value.hasPendingApprovals ||
          thread.value.hasPendingUserInput
        ) {
          yield* update(
            row,
            "pending",
            "Waiting for the thread to be idle without unanswered requests.",
            iso((yield* Clock.currentTimeMillis) + 30_000),
          );
          return;
        }
        const probeAt = yield* Clock.currentTimeMillis;
        const list = yield* providers.refreshInstance(execution.modelSelection.instanceId);
        const provider = list.find(
          (entry) => entry.instanceId === execution.modelSelection.instanceId,
        );
        if (
          !provider ||
          provider.driver !== "codex" ||
          !provider.enabled ||
          !provider.installed ||
          execution.modelSelection.model.toLowerCase().includes("spark") ||
          identity(provider) !== row.auth_identity
        ) {
          yield* update(row, "canceled", "The provider or signed-in account changed.");
          return;
        }
        const limits = provider.usageLimits;
        if (!limits || limits.unavailable || Date.parse(limits.checkedAt) < probeAt) {
          const attempts = row.probe_failures + 1;
          yield* update(
            row,
            attempts >= 3 ? "failed" : "pending",
            attempts >= 3
              ? "Usage could not be checked after three attempts. Schedule again to retry."
              : "Usage check failed; the host will retry.",
            iso((yield* Clock.currentTimeMillis) + attempts * 60_000),
            attempts,
          );
          return;
        }
        const blocked = limits.windows.filter((window) => window.usedPercent >= 100);
        if (blocked.length) {
          const now = yield* Clock.currentTimeMillis;
          if (blocked.some((window) => !window.resetsAt || Date.parse(window.resetsAt) <= now)) {
            yield* update(
              row,
              "failed",
              "The provider still reports a limit without a future reset. Schedule again after refreshing usage.",
            );
            return;
          }
          yield* update(
            row,
            "pending",
            "The provider still reports a usage limit.",
            iso(Math.max(...blocked.map((window) => Date.parse(window.resetsAt!)))),
            0,
          );
          return;
        }
        if (!limits.windows.length) {
          yield* update(row, "failed", "The provider did not report usable quota windows.");
          return;
        }
        const claimed =
          yield* sql<Row>`UPDATE usage_resumes SET status='dispatching', reason=NULL, updated_at=${iso(yield* Clock.currentTimeMillis)} WHERE id=${row.id} AND status='pending' RETURNING *`;
        if (!claimed.length) return;
        yield* notify(threadId);
        yield* engine
          .dispatch({
            type: "thread.turn.start",
            commandId: commandId(row.id),
            usageResumeId: row.id,
            threadId,
            message: {
              messageId: MessageId.make(`usage-resume:${row.id}`),
              role: "user",
              text: row.prompt,
              attachments: [],
            },
            ...execution,
            createdAt: iso(yield* Clock.currentTimeMillis),
          })
          .pipe(
            Effect.matchEffect({
              onSuccess: () => Effect.void,
              onFailure: () =>
                update(
                  row,
                  "failed",
                  "The continuation could not be confirmed. Check the thread before sending again.",
                ),
            }),
          );
      });
    const reconcile = (row: Row, restarting = false) =>
      Effect.gen(function* () {
        const started = yield* sql<{
          readonly turn_id: string;
        }>`SELECT turn_id FROM projection_turns WHERE thread_id=${row.thread_id} AND pending_message_id=${`usage-resume:${row.id}`} AND turn_id IS NOT NULL AND started_at IS NOT NULL LIMIT 1`;
        if (started.length) {
          yield* update(row, "dispatched", "The provider started the continuation.");
          return;
        }
        if (restarting) {
          const receipt = yield* receipts.getByCommandId({ commandId: commandId(row.id) });
          yield* update(
            row,
            "failed",
            Option.isSome(receipt) && receipt.value.status === "accepted"
              ? "The host accepted the continuation before restarting, but provider delivery is unconfirmed. Check the thread before sending again."
              : "The host restarted during dispatch. Check the thread before sending again.",
          );
          return;
        }
        const failures = yield* sql<{ readonly activity_id: string }>`
          SELECT activity_id FROM projection_thread_activities
          WHERE thread_id=${row.thread_id} AND kind='provider.turn.start.failed'
            AND json_extract(payload_json, '$.requestId')=${`usage-resume:${row.id}`}
          LIMIT 1
        `;
        if (failures.length)
          yield* update(
            row,
            "failed",
            "The provider could not start the continuation. Check the thread before trying again.",
          );
      });
    const tick = () =>
      mapError(
        Effect.gen(function* () {
          const now = iso(yield* Clock.currentTimeMillis);
          const dispatched =
            yield* sql<Row>`SELECT * FROM usage_resumes WHERE status='dispatching'`;
          for (const row of dispatched) yield* reconcile(row);
          const due =
            yield* sql<Row>`SELECT * FROM usage_resumes WHERE status='pending' AND scheduled_at <= ${now} ORDER BY scheduled_at`;
          for (const row of due)
            yield* dispatch(row).pipe(
              Effect.catch(() =>
                update(
                  row,
                  "failed",
                  "The scheduled resume failed. Check the thread before trying again.",
                ),
              ),
            );
        }),
      );
    const start = () =>
      Effect.gen(function* () {
        // A claimed send may already have reached the provider. Never replay it.
        const interrupted = yield* sql<Row>`SELECT * FROM usage_resumes WHERE status='dispatching'`;
        for (const row of interrupted) yield* reconcile(row, true);
        const events = yield* engine.subscribeDomainEvents;
        yield* events.pipe(
          Stream.filter(
            (event) =>
              event.type === "thread.session-set" ||
              (event.type === "thread.activity-appended" &&
                event.payload.activity.kind === "provider.turn.start.failed"),
          ),
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              const row = (yield* rows(ThreadId.make(event.aggregateId)))[0];
              if (row?.status === "dispatching") yield* reconcile(row);
            }).pipe(Effect.ignoreCause({ log: true })),
          ),
          Effect.forkScoped,
        );
        yield* Effect.gen(function* () {
          yield* tick().pipe(Effect.ignoreCause({ log: true }));
          const pending = yield* sql<{
            readonly next: string | null;
          }>`SELECT MIN(scheduled_at) AS next FROM usage_resumes WHERE status='pending'`;
          const next = pending[0]?.next;
          const wait = next
            ? Math.max(1, Date.parse(next) - (yield* Clock.currentTimeMillis))
            : 60 * 60 * 1000;
          // The minute cap reconciles a sleeping host's wall clock after wake.
          yield* Effect.raceFirst(Queue.take(wake), Effect.sleep(Math.min(wait, 60_000)));
        }).pipe(Effect.forever, Effect.forkScoped);
      }).pipe(
        Effect.catchCause((cause) => Effect.logError("Usage resume scheduler failed", cause)),
      );
    const subscribe = (threadId: ThreadId) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(changes);
          const events = yield* engine.subscribeDomainEvents;
          return Stream.concat(
            Stream.fromEffect(get(threadId)),
            Stream.mergeAll(
              [
                Stream.fromSubscription(subscription).pipe(Stream.filter((id) => id === threadId)),
                events.pipe(
                  Stream.filter(
                    (event) =>
                      event.aggregateId === threadId &&
                      [
                        "thread.session-set",
                        "thread.turn-start-requested",
                        "thread.turn-interrupt-requested",
                        "thread.session-stop-requested",
                        "thread.checkpoint-revert-requested",
                        "thread.reverted",
                        "thread.archived",
                        "thread.deleted",
                        "thread.meta-updated",
                        "thread.runtime-mode-set",
                        "thread.interaction-mode-set",
                      ].includes(event.type),
                  ),
                  Stream.map(() => threadId),
                ),
                providers.streamChanges.pipe(Stream.map(() => threadId)),
              ],
              { concurrency: "unbounded" },
            ).pipe(Stream.mapEffect(() => get(threadId))),
          );
        }),
      );
    return UsageResumeService.of({ get, schedule, cancel, subscribe, start, tick });
  }),
);
