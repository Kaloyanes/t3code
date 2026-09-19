import { type OrchestrationEvent, type ProjectId } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { issuesToCompleteOnMerge } from "./IssueCompletionPolicy.ts";
import * as Issues from "./IssueService.ts";

export class IssueCompletionReactor extends Context.Service<
  IssueCompletionReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/issue/IssueCompletionReactor") {}

export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const settings = yield* ServerSettings.ServerSettingsService;
  const issues = yield* Issues.IssueService;
  const handled = new Set<string>();

  const completeProject = Effect.fn("IssueCompletionReactor.completeProject")(function* (
    projectId: ProjectId,
  ) {
    const snapshot = yield* snapshots.getShellSnapshot();
    const project = snapshot.projects.find((candidate) => candidate.id === projectId);
    if (project === undefined) return;
    const enabled = resolveProjectSettings(yield* settings.getSettings, projectId).settings
      .completeLinkedIssueOnMerge;
    const candidates = issuesToCompleteOnMerge({
      enabled,
      issues: project.worktreeIssues ?? [],
      pullRequests: project.worktreePullRequests ?? [],
    });
    yield* Effect.forEach(
      candidates,
      (link) => {
        const reference = {
          projectId,
          host: link.issue.host,
          repository: link.issue.repository,
          number: link.issue.number,
        };
        const key =
          `${link.issue.host}/${link.issue.repository}#${link.issue.number}`.toLowerCase();
        if (handled.has(key)) return Effect.void;
        return Effect.gen(function* () {
          const issue = yield* issues.detail(reference);
          if (issue.state === "open") {
            yield* issues.close({ ...reference, reason: "completed" });
          }
          handled.add(key);
        }).pipe(
          Effect.retry({ times: 2 }),
          Effect.catch((error) =>
            Effect.logWarning("linked issue completion failed", {
              projectId,
              issue: key,
              error,
            }),
          ),
        );
      },
      { concurrency: 4, discard: true },
    );
  });

  const worker = yield* makeDrainableWorker(completeProject);
  const processEvent = (event: OrchestrationEvent) =>
    event.type === "project.meta-updated" &&
    event.payload.worktreePullRequests?.some((link) => link.snapshot?.state === "merged")
      ? worker.enqueue(event.payload.projectId)
      : Effect.void;

  const start: IssueCompletionReactor["Service"]["start"] = Effect.fn(
    "IssueCompletionReactor.start",
  )(function* () {
    const events = yield* engine.subscribeDomainEvents;
    yield* forkParked(Stream.runForEach(events, processEvent));
  });

  return { start, drain: worker.drain } satisfies IssueCompletionReactor["Service"];
});

export const layer = Layer.effect(IssueCompletionReactor, make);
