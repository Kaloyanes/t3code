import { expect, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { readIssueWorktreeThreads } from "./IssueWorktreeDeletion.ts";

const shell = (id: string, activeRunId: string | null) =>
  ({
    id: ThreadId.make(id),
    projectId: ProjectId.make("project"),
    branch: "feature",
    worktreePath: "/worktree",
    activeRunId: activeRunId === null ? null : RunId.make(activeRunId),
    providerInstanceId: ProviderInstanceId.make("codex"),
  }) as never;

it.effect("reports an active run as a running session on the worktree sibling", () =>
  Effect.gen(function* () {
    const siblings = yield* readIssueWorktreeThreads(ProjectId.make("project"));
    expect(siblings.map((thread) => thread.id)).toEqual(["idle", "working"]);
    expect(siblings[0]?.session).toBeNull();
    expect(siblings[1]?.session).toEqual({ status: "running", providerName: "codex" });
  }).pipe(
    Effect.provide(
      Layer.mock(ThreadManagement.ThreadManagementService)({
        listProjectThreads: () => Effect.succeed([shell("idle", null), shell("working", "run")]),
      }),
    ),
  ),
);
