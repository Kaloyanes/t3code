import { describe, expect, it } from "@effect/vitest";
import { RunId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import type * as ProjectionStore from "./ProjectionStore.ts";
import { limitRecoveryCommand } from "./UsageLimitRecoveryWorker.ts";

const STOPPED_AT = DateTime.makeUnsafe("2026-09-29T10:00:00.000Z");
const RESET_AT = "2026-09-29T12:00:00.000Z";

const candidate = (prompt?: string): ProjectionStore.ProjectionLimitRecoveryCandidate => ({
  id: ThreadId.make("thread"),
  status: "failed",
  lastErrorClass: "usage_limit",
  latestRunId: RunId.make("run"),
  usageLimitResetAt: RESET_AT,
  archivedAt: null,
  settledOverride: null,
  pendingRuntimeRequest: null,
  latestRunCompletedAt: STOPPED_AT,
  updatedAt: STOPPED_AT,
  limitRecovery: {
    runId: RunId.make("run"),
    resetAt: RESET_AT,
    autoResume: true,
    ...(prompt === undefined ? {} : { prompt }),
  },
  snoozedUntil: null,
});

describe("limitRecoveryCommand", () => {
  const afterReset = Date.parse(RESET_AT) + 1;

  it("continues with the default message when no prompt was chosen", () => {
    const command = limitRecoveryCommand(candidate(), true, afterReset);
    expect(command?.type === "message.dispatch" && command.text).toBe(
      "Continue where you left off.",
    );
  });

  it("sends the prompt the user scheduled for the reset", () => {
    const command = limitRecoveryCommand(
      candidate("Finish the migration tests."),
      true,
      afterReset,
    );
    expect(command?.type === "message.dispatch" && command.text).toBe(
      "Finish the migration tests.",
    );
  });
});
