import type {
  IssueCloseInput,
  IssueDetachedWorkspace,
  IssueRef,
  ProjectId,
  ThreadId,
  IssueState,
  IssueWorktreeDeleteInput,
  IssueWorktreeDeleteItemResult,
  IssueWorktreeDeletePreflightItem,
  IssueWorktreeDeleteSelection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export const deleteIssueWorktree = Effect.fn("deleteIssueWorktree")(function* (
  input: IssueWorktreeDeleteInput,
  selection: IssueWorktreeDeleteSelection,
  operations: {
    preflight: () => Effect.Effect<IssueWorktreeDeletePreflightItem, Error>;
    close: (input: IssueCloseInput) => Effect.Effect<unknown, Error>;
    state: (input: IssueRef) => Effect.Effect<IssueState, Error>;
    detach: () => Effect.Effect<
      {
        detachedWorkspace: IssueDetachedWorkspace | null;
        restore: Effect.Effect<void, Error>;
      },
      Error
    >;
    remove: () => Effect.Effect<unknown, Error>;
  },
): Effect.fn.Return<IssueWorktreeDeleteItemResult> {
  const warnings: string[] = [];
  const closedIssues: string[] = [];
  const failed = (error: string): IssueWorktreeDeleteItemResult => ({
    ...selection,
    deleted: false,
    error,
    detachedWorkspace: null,
    warnings: [...warnings, ...closedIssues],
  });
  const checked = yield* operations.preflight().pipe(Effect.option);
  if (Option.isNone(checked)) return failed("Unable to check the worktree. Nothing was deleted.");
  const preflight = checked.value;
  if (preflight.blocked) return failed(preflight.reason ?? "Worktree deletion is blocked.");
  if (
    preflight.requiresForce &&
    !input.forceAcknowledged &&
    !(input.preserveUnpushedCommits && preflight.changedFiles.length === 0)
  ) {
    return failed("Force acknowledgement is required.");
  }
  for (const issue of preflight.issues ?? []) {
    const decision = input.issueDecisions?.find(
      (entry) =>
        entry.projectId === issue.projectId &&
        entry.host === issue.host &&
        entry.repository === issue.repository &&
        entry.number === issue.number,
    );
    if (!decision || decision.action === "keep-open" || issue.state === "closed") continue;
    const label = `${issue.repository}#${issue.number}`;
    const closed = yield* operations
      .close({ ...issue, reason: decision.action })
      .pipe(Effect.option);
    if (Option.isSome(closed)) {
      closedIssues.push(
        `${label} closed as ${decision.action === "completed" ? "completed" : "not planned"}.`,
      );
      continue;
    }
    const state = yield* operations.state(issue).pipe(Effect.option);
    warnings.push(
      Option.isNone(state)
        ? `${label}: closing could not be confirmed. Check the issue's status.`
        : state.value === "open"
          ? `${label} remains open. Closing failed.`
          : `${label} is closed. The requested close reason could not be confirmed.`,
    );
  }
  const detached = yield* operations.detach().pipe(Effect.option);
  if (Option.isNone(detached))
    return failed(
      "Unable to detach worktree threads. Review their workspace associations before retrying.",
    );
  const removed = yield* operations.remove().pipe(Effect.option);
  if (Option.isNone(removed)) {
    const restored = yield* detached.value.restore.pipe(Effect.option);
    return failed(
      Option.isSome(restored)
        ? "Unable to delete worktree. Workspace associations were restored."
        : "Unable to delete worktree. Some workspace associations could not be restored.",
    );
  }
  return {
    ...selection,
    deleted: true,
    error: null,
    detachedWorkspace: detached.value.detachedWorkspace,
    warnings,
  };
});

export function resolveIssueWorktreeAttachment(
  projectId: ProjectId,
  thread: { projectId: ProjectId; branch: string | null; worktreePath: string | null } | undefined,
  link: { projectId: ProjectId; branch: string | null; worktreePath: string | null } | undefined,
) {
  const attachment = thread ?? link;
  return attachment?.projectId === projectId && attachment.worktreePath !== null
    ? attachment
    : null;
}

export const readIssueWorktreeThreads = Effect.fn("readIssueWorktreeThreads")(function* (
  projectId: ProjectId,
) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    id: ThreadId;
    projectId: ProjectId;
    branch: string | null;
    worktreePath: string | null;
    status: string | null;
    providerName: string | null;
  }>`
    SELECT threads.thread_id AS id, threads.project_id AS "projectId", threads.branch,
      threads.worktree_path AS "worktreePath", sessions.status, sessions.provider_name AS "providerName"
    FROM projection_threads threads
    LEFT JOIN projection_thread_sessions sessions ON sessions.thread_id = threads.thread_id
    WHERE threads.project_id = ${projectId} AND threads.deleted_at IS NULL
  `;
  return rows.map(({ status, providerName, ...thread }) => ({
    ...thread,
    session: status === null ? null : { status, providerName },
  }));
});
