import {
  IsoDateTime,
  PositiveInt,
  ProjectId,
  ThreadPullRequestSnapshot,
  ThreadPullRequestStack,
  TrimmedNonEmptyString,
  WorktreePullRequestLink,
  WorktreePullRequestLinkSource,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Struct from "effect/Struct";

import { normalizeThreadPullRequestKey } from "@t3tools/shared/threadPullRequests";
import { toPersistenceSqlError, type ProjectionRepositoryError } from "./Errors.ts";

export const ProjectionProjectWorktreePullRequest = Schema.Struct({
  projectId: ProjectId,
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  host: TrimmedNonEmptyString,
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
  url: TrimmedNonEmptyString,
  source: WorktreePullRequestLinkSource,
  linkedAt: IsoDateTime,
  snapshot: Schema.NullOr(ThreadPullRequestSnapshot),
  stack: Schema.NullOr(ThreadPullRequestStack),
});
export type ProjectionProjectWorktreePullRequest = typeof ProjectionProjectWorktreePullRequest.Type;

export const ListProjectionProjectWorktreePullRequestsInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
});
export type ListProjectionProjectWorktreePullRequestsInput =
  typeof ListProjectionProjectWorktreePullRequestsInput.Type;

export const ReplaceProjectionProjectWorktreePullRequestsInput = Schema.Struct({
  projectId: ProjectId,
  links: Schema.Array(WorktreePullRequestLink),
});
export type ReplaceProjectionProjectWorktreePullRequestsInput =
  typeof ReplaceProjectionProjectWorktreePullRequestsInput.Type;

const ProjectionProjectWorktreePullRequestDbRow = ProjectionProjectWorktreePullRequest.mapFields(
  Struct.assign({
    snapshot: Schema.NullOr(Schema.fromJsonString(ThreadPullRequestSnapshot)),
    stack: Schema.NullOr(Schema.fromJsonString(ThreadPullRequestStack)),
  }),
);

function storageWorktreePath(path: string | null): string {
  return path ?? "";
}

function publicWorktreePath(path: string): string | null {
  return path === "" ? null : path;
}

export class ProjectionProjectWorktreePullRequestRepository extends Context.Service<
  ProjectionProjectWorktreePullRequestRepository,
  {
    readonly list: (
      input: ListProjectionProjectWorktreePullRequestsInput,
    ) => Effect.Effect<
      ReadonlyArray<ProjectionProjectWorktreePullRequest>,
      ProjectionRepositoryError
    >;
    readonly replace: (
      input: ReplaceProjectionProjectWorktreePullRequestsInput,
    ) => Effect.Effect<void, ProjectionRepositoryError>;
    readonly deleteByProjectId: (input: {
      readonly projectId: ProjectId;
    }) => Effect.Effect<void, ProjectionRepositoryError>;
  }
>()(
  "t3/persistence/ProjectionProjectWorktreePullRequests/ProjectionProjectWorktreePullRequestRepository",
) {}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listRows = SqlSchema.findAll({
    Request: ListProjectionProjectWorktreePullRequestsInput,
    Result: ProjectionProjectWorktreePullRequestDbRow,
    execute: ({ projectId }) => sql`
      SELECT
        project_id AS "projectId",
        NULLIF(worktree_path, '') AS "worktreePath",
        host,
        repository,
        number,
        url,
        source,
        linked_at AS "linkedAt",
        snapshot_json AS "snapshot",
        stack_json AS "stack"
      FROM projection_project_worktree_pull_requests
      ${projectId === undefined ? sql`` : sql`WHERE project_id = ${projectId}`}
      ORDER BY linked_at ASC, number ASC
    `,
  });

  const deleteByProject = SqlSchema.void({
    Request: Schema.Struct({ projectId: ProjectId }),
    execute: ({ projectId }) => sql`
      DELETE FROM projection_project_worktree_pull_requests
      WHERE project_id = ${projectId}
    `,
  });

  const insert = SqlSchema.void({
    Request: ProjectionProjectWorktreePullRequest,
    execute: (row) => sql`
      INSERT INTO projection_project_worktree_pull_requests (
        project_id,
        worktree_path,
        host,
        repository,
        number,
        url,
        source,
        linked_at,
        snapshot_json,
        stack_json
      )
      VALUES (
        ${row.projectId},
        ${storageWorktreePath(row.worktreePath)},
        ${row.host},
        ${row.repository},
        ${row.number},
        ${row.url},
        ${row.source},
        ${row.linkedAt},
        ${row.snapshot === null ? null : JSON.stringify(row.snapshot)},
        ${row.stack === null ? null : JSON.stringify(row.stack)}
      )
      ON CONFLICT (project_id, worktree_path, host, repository, number)
      DO UPDATE SET
        url = excluded.url,
        source = excluded.source,
        linked_at = excluded.linked_at,
        snapshot_json = excluded.snapshot_json,
        stack_json = excluded.stack_json
    `,
  });

  const list: ProjectionProjectWorktreePullRequestRepository["Service"]["list"] = (input) =>
    listRows(input).pipe(
      Effect.map((rows) =>
        rows.map((row) => ({ ...row, worktreePath: publicWorktreePath(row.worktreePath ?? "") })),
      ),
      Effect.mapError(
        toPersistenceSqlError("ProjectionProjectWorktreePullRequestRepository.list:query"),
      ),
    );

  const replace: ProjectionProjectWorktreePullRequestRepository["Service"]["replace"] = ({
    projectId,
    links,
  }) =>
    deleteByProject({ projectId }).pipe(
      Effect.andThen(
        Effect.forEach(
          links,
          (link) =>
            insert({
              projectId,
              worktreePath: link.worktreePath,
              ...normalizeThreadPullRequestKey(link),
              url: link.url,
              source: link.source,
              linkedAt: link.linkedAt,
              snapshot: link.snapshot,
              stack: link.stack,
            }),
          { discard: true },
        ),
      ),
      Effect.mapError(
        toPersistenceSqlError("ProjectionProjectWorktreePullRequestRepository.replace:query"),
      ),
    );

  const deleteProject: ProjectionProjectWorktreePullRequestRepository["Service"]["deleteByProjectId"] =
    (input) =>
      deleteByProject(input).pipe(
        Effect.mapError(
          toPersistenceSqlError(
            "ProjectionProjectWorktreePullRequestRepository.deleteByProjectId:query",
          ),
        ),
      );

  return {
    list,
    replace,
    deleteByProjectId: deleteProject,
  } satisfies ProjectionProjectWorktreePullRequestRepository["Service"];
});

export const layer = Layer.effect(ProjectionProjectWorktreePullRequestRepository, make);
