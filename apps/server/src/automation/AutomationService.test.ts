import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { AutomationExecution, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { AutomationService, layer as automationLayer } from "./AutomationService.ts";

const layer = it.layer(
  automationLayer.pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(NodeServices.layer),
  ),
);

layer("AutomationService", (it) => {
  it.effect("creates and controls an automation without changing run history", () =>
    Effect.gen(function* () {
      const service = yield* AutomationService;
      const projectId = ProjectId.make("project-1");
      const execution = Schema.decodeSync(AutomationExecution)({
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
        baseBranch: "main",
      });
      const created = yield* service.create({
        projectId,
        name: "Health check",
        prompt: "Run the repository checks and summarize failures.",
        schedule: {
          kind: "once",
          date: "2099-09-20",
          time: "09:30",
          timeZone: "UTC",
        },
        execution,
      });
      const id = created.automations[0]?.id;
      assert.isDefined(id);
      assert.strictEqual(created.automations[0]?.status, "active");
      assert.strictEqual(created.automations[0]?.nextRunAt, "2099-09-20T09:30:00.000Z");

      const paused = yield* service.pause({ id: id! });
      assert.strictEqual(paused.automations[0]?.status, "paused");
      assert.isNull(paused.automations[0]?.nextRunAt);

      const resumed = yield* service.resume({ id: id! });
      assert.strictEqual(resumed.automations[0]?.status, "active");
      assert.strictEqual(resumed.automations[0]?.nextRunAt, "2099-09-20T09:30:00.000Z");

      const manual = yield* service.runNow({ id: id! });
      assert.strictEqual(manual.runs[0]?.trigger, "manual");
      assert.strictEqual(manual.runs[0]?.status, "scheduled");

      const canceled = yield* service.cancel({ id: id! });
      assert.strictEqual(canceled.automations[0]?.status, "canceled");
      assert.strictEqual(canceled.runs[0]?.status, "scheduled");
    }),
  );
});
