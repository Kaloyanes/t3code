import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  OrchestrationThreadShell,
  ProviderDriverKind,
  ServerProvider,
  ThreadId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { OrchestrationCommandReceiptRepository } from "../persistence/Services/OrchestrationCommandReceipts.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { UsageResumeService, layer } from "./UsageResumeService.ts";
import { usageResumeEligibility } from "./usageResumeEligibility.ts";

const threadId = ThreadId.make("resume-thread");
const at = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));
const decodeShell = Schema.decodeUnknownSync(OrchestrationThreadShell);
const decodeProvider = Schema.decodeSync(ServerProvider);
const shell = () =>
  decodeShell({
    id: threadId,
    projectId: "project",
    title: "Quota stop",
    modelSelection: { instanceId: "codex", model: "gpt-5" },
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: at(0),
    updatedAt: at(0),
    latestUserMessageAt: at(0),
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    session: {
      threadId,
      status: "error",
      providerName: "codex",
      providerSessionId: "session",
      activeTurnId: null,
      lastError: "Codex usage limit reached.",
      updatedAt: at(0),
    },
  });
const provider = (now: number, exhausted = true) =>
  decodeProvider({
    instanceId: "codex",
    driver: "codex",
    enabled: true,
    installed: true,
    version: "1",
    status: "ready",
    models: [],
    auth: { status: "authenticated", email: "test@example.com" },
    checkedAt: at(now),
    usageLimits: {
      checkedAt: at(now),
      windows: [
        {
          id: "primary",
          kind: "session",
          label: "Session",
          usedPercent: exhausted ? 100 : 20,
          resetsAt: at(60_000),
        },
      ],
    },
  });

const harness = Effect.gen(function* () {
  yield* TestClock.setTime(0);
  let thread = shell();
  let limited = true;
  let unavailable = false;
  let gate: Deferred.Deferred<void> | undefined;
  let entered: Deferred.Deferred<void> | undefined;
  let accepted = false;
  let differentAccount = false;
  let acknowledgeStart = true;
  let differentDriver = false;
  const probed = yield* Deferred.make<void>();
  const dispatched = yield* Deferred.make<void>();
  const commands: OrchestrationCommand[] = [];
  const sql = yield* SqlClient.SqlClient;
  const readProviders = Effect.gen(function* () {
    const original = provider(yield* Clock.currentTimeMillis, limited);
    const value = differentAccount
      ? { ...original, auth: { ...original.auth, email: "other@example.com" } }
      : original;
    return [
      {
        ...value,
        ...(differentDriver ? { driver: ProviderDriverKind.make("claudeAgent") } : {}),
        ...(unavailable
          ? {
              usageLimits: {
                checkedAt: value.checkedAt,
                windows: [],
                unavailable: { reason: "probeFailed" as const },
              },
            }
          : {}),
      },
    ];
  });
  const services = layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProjectionSnapshotQuery)({
          getThreadShellById: () => Effect.sync(() => Option.some(thread)),
        }),
        Layer.mock(ProviderRegistry)({
          getProviders: readProviders,
          refreshInstance: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(probed, undefined);
              if (gate) {
                if (entered) yield* Deferred.succeed(entered, undefined);
                yield* Deferred.await(gate);
              }
              return yield* readProviders;
            }),
          streamChanges: Stream.empty,
        }),
        Layer.mock(OrchestrationEngineService)({
          dispatch: (command) =>
            Effect.gen(function* () {
              commands.push(command);
              if (acknowledgeStart && command.type === "thread.turn.start")
                yield* sql`INSERT INTO projection_turns (thread_id, turn_id, pending_message_id, state, requested_at, started_at, checkpoint_files_json) VALUES (${threadId}, 'provider-turn', ${command.message.messageId}, 'running', ${at(60_000)}, ${at(60_000)}, '[]')`;
              yield* Deferred.succeed(dispatched, undefined);
              return { sequence: commands.length };
            }).pipe(Effect.orDie),
          subscribeDomainEvents: Effect.succeed(Stream.empty),
          streamDomainEvents: Stream.empty,
        }),
        Layer.mock(OrchestrationCommandReceiptRepository)({
          getByCommandId: ({ commandId }) =>
            Effect.sync(() =>
              accepted
                ? Option.some({
                    commandId,
                    aggregateKind: "thread" as const,
                    aggregateId: threadId,
                    acceptedAt: at(0),
                    resultSequence: 1,
                    status: "accepted" as const,
                    error: null,
                  })
                : Option.none(),
            ),
        }),
      ),
    ),
  );
  const context = yield* Layer.build(services);
  const service = Context.get(context, UsageResumeService);
  return {
    service,
    commands,
    dispatched,
    rebuild: Layer.build(services).pipe(
      Effect.map((context) => Context.get(context, UsageResumeService)),
    ),
    setLimited: (value: boolean) => {
      limited = value;
    },
    setUnavailable: () => {
      unavailable = true;
    },
    blockProbe: (value: Deferred.Deferred<void>, started: Deferred.Deferred<void>) => {
      gate = value;
      entered = started;
    },
    probed,
    acceptReceipt: () => {
      accepted = true;
    },
    changeAccount: () => {
      differentAccount = true;
    },
    changeDriver: () => {
      differentDriver = true;
    },
    withholdProviderStart: () => {
      acknowledgeStart = false;
    },
    setBusy: () => {
      thread = { ...thread, hasPendingUserInput: true };
    },
  };
});

const testLayer = Layer.mergeAll(SqlitePersistenceMemory, NodeServices.layer);
it.effect("rejects scheduling if Stop arrives during the usage refresh", () =>
  Effect.gen(function* () {
    const { service, blockProbe } = yield* harness;
    const gate = yield* Deferred.make<void>();
    const entered = yield* Deferred.make<void>();
    blockProbe(gate, entered);
    const scheduling = yield* service
      .schedule({ threadId, prompt: "Continue" })
      .pipe(Effect.exit, Effect.forkChild);
    yield* Deferred.await(entered);
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO orchestration_events (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, actor_kind, payload_json, metadata_json)
      VALUES ('stop-during-refresh', 'thread', ${threadId}, 1, 'thread.session-stop-requested', ${at(0)}, 'client', '{}', '{}')`;
    yield* Deferred.succeed(gate, undefined);
    assert.equal((yield* Fiber.join(scheduling))._tag, "Failure");
    assert.isNull((yield* service.get(threadId)).schedule);
  }).pipe(Effect.provide(testLayer)),
);
it.effect("persists one schedule and dispatches only after the reset with fresh quota", () =>
  Effect.gen(function* () {
    const { service, commands, setLimited } = yield* harness;
    const saved = yield* service.schedule({ threadId, prompt: "Continue carefully." });
    assert.equal(saved.schedule?.scheduledAt, at(60_000));
    assert.isTrue(
      (yield* Effect.exit(service.schedule({ threadId, prompt: "Duplicate" })))._tag === "Failure",
    );
    yield* service.tick();
    assert.lengthOf(commands, 0);
    yield* TestClock.adjust("60 seconds");
    setLimited(false);
    yield* service.tick();
    yield* service.tick();
    assert.lengthOf(commands, 1);
    assert.equal(commands[0]?.type === "thread.turn.start" ? commands[0].threadId : null, threadId);
    assert.equal((yield* service.get(threadId)).schedule?.status, "dispatched");
  }).pipe(Effect.provide(testLayer)),
);
it.effect("host timer dispatches with no client connected", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { service, commands, setLimited, dispatched } = yield* harness;
      yield* service.schedule({ threadId, prompt: "Continue" });
      setLimited(false);
      yield* service.start();
      assert.lengthOf(commands, 0);
      yield* TestClock.adjust("60 seconds");
      yield* Deferred.await(dispatched);
      assert.lengthOf(commands, 1);
    }),
  ).pipe(Effect.provide(testLayer)),
);
it.effect("a reconstructed host runs an overdue pending resume", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { service, commands, setLimited, dispatched, rebuild } = yield* harness;
      yield* service.schedule({ threadId, prompt: "Continue" });
      setLimited(false);
      yield* TestClock.adjust("90 seconds");
      const restarted = yield* rebuild;
      assert.equal((yield* restarted.get(threadId)).schedule?.status, "pending");
      yield* restarted.start();
      yield* Deferred.await(dispatched);
      assert.lengthOf(commands, 1);
    }),
  ).pipe(Effect.provide(testLayer)),
);
it.effect("cancellation during the quota probe prevents dispatch", () =>
  Effect.gen(function* () {
    const { service, commands, setLimited, blockProbe } = yield* harness;
    const saved = yield* service.schedule({ threadId, prompt: "Continue" });
    yield* TestClock.adjust("60 seconds");
    setLimited(false);
    const gate = yield* Deferred.make<void>();
    const entered = yield* Deferred.make<void>();
    blockProbe(gate, entered);
    const fiber = yield* service.tick().pipe(Effect.forkChild);
    yield* Deferred.await(entered);
    yield* service.cancel({ threadId, id: saved.schedule!.id });
    yield* Deferred.succeed(gate, undefined);
    yield* Fiber.join(fiber);
    assert.lengthOf(commands, 0);
    assert.equal((yield* service.get(threadId)).schedule?.status, "canceled");
  }).pipe(Effect.provide(testLayer)),
);
it.effect("stops after three failed probes", () =>
  Effect.gen(function* () {
    const { service, commands, setUnavailable } = yield* harness;
    yield* service.schedule({ threadId, prompt: "Continue" });
    yield* TestClock.adjust("60 seconds");
    setUnavailable();
    yield* service.tick();
    yield* TestClock.adjust("60 seconds");
    yield* service.tick();
    yield* TestClock.adjust("120 seconds");
    yield* service.tick();
    assert.equal((yield* service.get(threadId)).schedule?.status, "failed");
    assert.lengthOf(commands, 0);
  }).pipe(Effect.provide(testLayer)),
);
it.effect("does not send while user input is outstanding", () =>
  Effect.gen(function* () {
    const { service, commands, setBusy, setLimited } = yield* harness;
    yield* service.schedule({ threadId, prompt: "Continue" });
    setBusy();
    setLimited(false);
    yield* TestClock.adjust("60 seconds");
    yield* service.tick();
    assert.lengthOf(commands, 0);
    assert.equal(
      (yield* service.get(threadId)).schedule?.reason,
      "Waiting for the thread to be idle without unanswered requests.",
    );
    yield* service.cancel({ threadId, id: (yield* service.get(threadId)).schedule!.id });
  }).pipe(Effect.provide(testLayer)),
);
it.effect("cancels a resume when the account changes", () =>
  Effect.gen(function* () {
    const { service, commands, changeAccount, setLimited } = yield* harness;
    yield* service.schedule({ threadId, prompt: "Continue" });
    changeAccount();
    setLimited(false);
    yield* TestClock.adjust("60 seconds");
    yield* service.tick();
    assert.lengthOf(commands, 0);
    assert.equal((yield* service.get(threadId)).schedule?.status, "canceled");
  }).pipe(Effect.provide(testLayer)),
);
it.effect("fails visibly when an accepted command has no durable provider start", () =>
  Effect.gen(function* () {
    const { service, commands, acceptReceipt } = yield* harness;
    yield* service.schedule({ threadId, prompt: "Continue" });
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE usage_resumes SET status='dispatching' WHERE thread_id=${threadId}`;
    acceptReceipt();
    yield* service.start();
    assert.equal((yield* service.get(threadId)).schedule?.status, "failed");
    assert.lengthOf(commands, 0);
  }).pipe(Effect.provide(testLayer)),
);
it.effect("restart never replays an uncertain claimed dispatch", () =>
  Effect.gen(function* () {
    const { service, commands } = yield* harness;
    yield* service.schedule({ threadId, prompt: "Continue" });
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE usage_resumes SET status='dispatching' WHERE thread_id=${threadId}`;
    yield* service.start();
    assert.equal((yield* service.get(threadId)).schedule?.status, "failed");
    assert.lengthOf(commands, 0);
  }).pipe(Effect.provide(testLayer)),
);

it.effect("does not call an accepted command sent until the provider has started", () =>
  Effect.gen(function* () {
    const { service, commands, setLimited, withholdProviderStart, acceptReceipt, rebuild } =
      yield* harness;
    yield* service.schedule({ threadId, prompt: "Continue" });
    setLimited(false);
    withholdProviderStart();
    yield* TestClock.adjust("60 seconds");
    yield* service.tick();
    acceptReceipt();
    yield* service.tick();
    assert.equal((yield* service.get(threadId)).schedule?.status, "dispatching");
    const restarted = yield* rebuild;
    yield* restarted.start();
    assert.equal((yield* restarted.get(threadId)).schedule?.status, "failed");
    assert.lengthOf(commands, 1);
  }).pipe(Effect.provide(testLayer)),
);

it.effect("recovers a durable provider start without sending again", () =>
  Effect.gen(function* () {
    const { service, commands, setLimited, rebuild } = yield* harness;
    yield* service.schedule({ threadId, prompt: "Continue" });
    setLimited(false);
    yield* TestClock.adjust("60 seconds");
    yield* service.tick();
    const restarted = yield* rebuild;
    yield* restarted.start();
    assert.equal((yield* restarted.get(threadId)).schedule?.status, "dispatched");
    assert.lengthOf(commands, 1);
  }).pipe(Effect.provide(testLayer)),
);

it.effect("reports a matching provider failure even at the same clock instant", () =>
  Effect.gen(function* () {
    const { service, setLimited, withholdProviderStart } = yield* harness;
    const saved = yield* service.schedule({ threadId, prompt: "Continue" });
    setLimited(false);
    withholdProviderStart();
    yield* TestClock.adjust("60 seconds");
    yield* service.tick();
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO projection_thread_activities (activity_id, thread_id, tone, kind, summary, payload_json, created_at) VALUES ('failed', ${threadId}, 'error', 'provider.turn.start.failed', 'Provider rejected the request', json_object('requestId', ${`usage-resume:${saved.schedule!.id}`}), ${at(60_000)})`;
    yield* service.tick();
    assert.equal((yield* service.get(threadId)).schedule?.status, "failed");
  }).pipe(Effect.provide(testLayer)),
);

it.effect("rejects cancellation once dispatch has claimed the schedule", () =>
  Effect.gen(function* () {
    const { service, setLimited, withholdProviderStart } = yield* harness;
    const saved = yield* service.schedule({ threadId, prompt: "Continue" });
    setLimited(false);
    withholdProviderStart();
    yield* TestClock.adjust("60 seconds");
    yield* service.tick();
    const outcome = yield* Effect.exit(service.cancel({ threadId, id: saved.schedule!.id }));
    assert.equal(outcome._tag, "Failure");
    assert.equal((yield* service.get(threadId)).schedule?.status, "dispatching");
  }).pipe(Effect.provide(testLayer)),
);

it.effect("cancels when an instance ID is replaced with another driver", () =>
  Effect.gen(function* () {
    const { service, commands, setLimited, changeDriver } = yield* harness;
    yield* service.schedule({ threadId, prompt: "Continue" });
    setLimited(false);
    changeDriver();
    yield* TestClock.adjust("60 seconds");
    yield* service.tick();
    assert.equal((yield* service.get(threadId)).schedule?.status, "canceled");
    assert.lengthOf(commands, 0);
  }).pipe(Effect.provide(testLayer)),
);

it("uses the latest exhausted window and refuses incomplete reset metadata", () => {
  const thread = shell();
  const source = provider(0);
  const limits = source.usageLimits!;
  const weekly = { ...limits.windows[0]!, id: "secondary", resetsAt: at(120_000) };
  assert.equal(
    usageResumeEligibility(
      thread,
      { ...source, usageLimits: { ...limits, windows: [...limits.windows, weekly] } },
      0,
    ).resetsAt,
    at(120_000),
  );
  assert.isFalse(
    usageResumeEligibility(
      thread,
      {
        ...source,
        usageLimits: {
          ...limits,
          windows: [{ id: "primary", kind: "session", label: "Session", usedPercent: 100 }],
        },
      },
      0,
    ).available,
  );
  assert.isNull(usageResumeEligibility({ ...thread, session: null }, source, 0).reason);
});
