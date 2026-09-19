import {
  DEFAULT_WORKTREE_BRANCH_PREFIX,
  CommandId,
  IssueOperationError,
  IssueUnavailableError,
  ProjectId,
  ThreadId,
  type IssueActor,
  type IssueAuthCancelInput,
  type IssueAuthStartInput,
  type IssueAuthStatus,
  type IssueAuthStatusInput,
  type IssueCandidatesInput,
  type IssueCandidatesResult,
  type IssueCloseInput,
  type IssueCloseResult,
  type IssueComment,
  type IssueCommentCreateInput,
  type IssueCommentCreateResult,
  type IssueCommentDeleteInput,
  type IssueCommentUpdateInput,
  type IssueCommentUpdateResult,
  type IssueCommentsInput,
  type IssueCommentsResult,
  type IssueCreateInput,
  type IssueCreateResult,
  type IssueDetail,
  type IssueInvalidateInput,
  type IssueLabel,
  type IssueLinkInput,
  type IssueLinkResult,
  type IssueLinkedWork,
  type IssueListEntry,
  type IssueListInput,
  type IssueListResult,
  type IssueMilestone,
  type IssueReaction,
  type IssueReactionUpdateInput,
  type IssueRef,
  type IssueRepositorySelection,
  type IssueReopenInput,
  type IssueReopenResult,
  type IssueTemplate,
  type IssueTemplatesInput,
  type IssueTemplatesResult,
  type IssueUpdateInput,
  type IssueUpdateResult,
  type IssueWorktree,
  type IssueWorktreeDeleteInput,
  type IssueWorktreeDeletePreflightInput,
  type IssueWorktreeDeletePreflightItem,
  type IssueWorktreeDeletePreflightResult,
  type IssueWorktreeDeleteResult,
  type IssueWorktreePrepareInput,
  type IssueWorktreePrepareResult,
  type IssueWorktreeReplaceInput,
  type IssueWorktreeReplaceResult,
  type ProjectId as ProjectIdType,
  type ThreadId as ThreadIdType,
} from "@t3tools/contracts";
import { sanitizeBranchFragment } from "@t3tools/shared/git";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as WorktreeRunManager from "../worktreeRun/Manager.ts";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { VcsListRefsResult } from "@t3tools/contracts";
import { parse as parseYaml } from "yaml";

import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import {
  findAuthenticatedGitHubAccount,
  parseGitHubAuthStatus,
} from "../sourceControl/gitHubAuthStatus.ts";

const GRAPHQL_ISSUE_FIELDS = `
  number title body url state stateReason createdAt updatedAt closedAt
  author { login avatarUrl }
  labels(first: 100) { nodes { name color description } }
  assignees(first: 100) { nodes { login name avatarUrl } }
  milestone { number title state description dueOn }
  comments { totalCount }
  reactions(first: 100) { nodes { content user { login } } }
`;
const GRAPHQL_ISSUE_FRAGMENT = `
fragment IssueFields on Issue { ${GRAPHQL_ISSUE_FIELDS} }
`;
const LIST_QUERY = `${GRAPHQL_ISSUE_FRAGMENT}
query($owner: String!, $name: String!, $first: Int!, $after: String, $states: [IssueState!]) {
  repository(owner: $owner, name: $name) {
    issues(first: $first, after: $after, states: $states, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { ...IssueFields }
      pageInfo { hasNextPage endCursor }
    }
  }
}
`;
const SEARCH_QUERY = `${GRAPHQL_ISSUE_FRAGMENT}
query($query: String!, $first: Int!, $after: String) {
  search(query: $query, type: ISSUE, first: $first, after: $after) {
    nodes { ... on Issue { ...IssueFields } }
    pageInfo { hasNextPage endCursor }
  }
}
`;
const DETAIL_QUERY = `${GRAPHQL_ISSUE_FRAGMENT}
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) { ...IssueFields } }
  viewer { login }
}
`;
const COMMENTS_QUERY = `
query($owner: String!, $name: String!, $number: Int!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      comments(first: $first, after: $after) {
        nodes {
          id databaseId body url createdAt updatedAt
          author { login avatarUrl }
          reactions(first: 100) { nodes { content user { login } } }
        }
        totalCount pageInfo { hasNextPage endCursor }
      }
    }
  }
}
`;

const REACTION_CONTENT: Readonly<Record<IssueReaction["content"], string>> = {
  "thumbs-up": "+1",
  "thumbs-down": "-1",
  laugh: "laugh",
  hooray: "hooray",
  confused: "confused",
  heart: "heart",
  rocket: "rocket",
  eyes: "eyes",
};

type JsonRecord = { readonly [key: string]: unknown };
type MutableJsonRecord = { [key: string]: unknown };
type IssueError = IssueUnavailableError | IssueOperationError;
type Repo = {
  readonly projectId: ProjectIdType;
  readonly host: string;
  readonly repository: string;
  readonly cwd: string;
  readonly projectTitle: string;
};
type CacheEntry<Value> = { readonly at: number; readonly value: Value };
type AuthFlow = {
  readonly id: string;
  readonly host: string;
  readonly expiresAt: string;
  readonly userCode: string;
  readonly cancel: Effect.Effect<void, never>;
};
type IssueLinkRow = {
  readonly threadId: string;
  readonly projectId: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly linkedAt: string;
  readonly source: string;
  readonly detachedAt: string | null;
};
type DetachedWorkspaceRow = {
  readonly threadId: string;
  readonly projectId: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly detachedAt: string;
};

export interface IssueNormalizationContext {
  readonly projectId: ProjectIdType;
  readonly host: string;
  readonly repository: string;
}

export type NormalizedIssue = IssueListEntry & {
  readonly body: string;
  readonly stateReason: IssueDetail["stateReason"];
  readonly assignees: IssueDetail["assignees"];
  readonly milestone: IssueMilestone | null;
  readonly reactions: ReadonlyArray<IssueReaction>;
};

const now = (): string => DateTime.formatIso(DateTime.nowUnsafe());

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const record = (value: unknown): JsonRecord => (isRecord(value) ? value : {});

const stringValue = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const positiveInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

const nonNegativeInteger = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

const arrayValue = (value: unknown): ReadonlyArray<unknown> => (Array.isArray(value) ? value : []);

const iso = (value: unknown): string => {
  const text = stringValue(value).trim();
  if (text.length === 0) return now();
  const parsed = DateTime.make(text);
  return Option.isSome(parsed) ? DateTime.formatIso(parsed.value) : now();
};

const normalizeHost = (value: string | undefined): string => {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) return "github.com";
  const withoutScheme = trimmed.replace(/^[a-z][a-z\d+.-]*:\/\//i, "");
  const withoutPath = withoutScheme.split("/", 1)[0] ?? "";
  return withoutPath.trim().toLowerCase();
};

const validHost = (host: string): boolean =>
  host.length > 0 && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/i.test(host);

const hostFromRemoteUrl = (remoteUrl: string): string | null => {
  const trimmed = remoteUrl.trim();
  const urlMatch = /^[a-z][a-z\d+.-]*:\/\/([^/]+)/i.exec(trimmed);
  if (urlMatch?.[1]) return normalizeHost(urlMatch[1]);
  const scpMatch = /^[^@]+@([^:]+):/.exec(trimmed);
  if (scpMatch?.[1]) return normalizeHost(scpMatch[1]);
  const firstSegment = trimmed.split("/", 1)[0] ?? "";
  return validHost(normalizeHost(firstSegment)) ? normalizeHost(firstSegment) : null;
};

const splitRepository = (
  repository: string,
): { readonly owner: string; readonly name: string } | null => {
  const pieces = repository
    .split("/")
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
  if (pieces.length !== 2) return null;
  const [owner, name] = pieces;
  if (!owner || !name || !/^[a-z\d_.-]+$/i.test(owner) || !/^[a-z\d_.-]+$/i.test(name)) {
    return null;
  }
  return { owner, name };
};

const issueUrl = (host: string, repository: string, number: number): string =>
  `https://${host}/${repository}/issues/${number}`;

const actor = (raw: unknown): IssueActor | null => {
  const value = record(raw);
  const login = stringValue(value.login).trim();
  if (login.length === 0) return null;
  return {
    login,
    name: typeof value.name === "string" ? value.name : null,
    avatarUrl: typeof value.avatarUrl === "string" ? value.avatarUrl : null,
  };
};

const labels = (raw: unknown): ReadonlyArray<IssueLabel> =>
  arrayValue(record(raw).nodes).flatMap((entry) => {
    const value = record(entry);
    const name = stringValue(value.name).trim();
    if (name.length === 0) return [];
    return [
      {
        name,
        color: typeof value.color === "string" ? value.color : null,
        ...(typeof value.description === "string" ? { description: value.description } : {}),
      },
    ];
  });

const milestone = (raw: unknown): IssueMilestone | null => {
  const value = record(raw);
  const number = positiveInteger(value.number);
  const title = stringValue(value.title).trim();
  if (number === null || title.length === 0) return null;
  return {
    number,
    title,
    state: value.state === "closed" || value.state === "CLOSED" ? "closed" : "open",
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    dueOn: value.dueOn === null || value.dueOn === undefined ? null : iso(value.dueOn),
  };
};

const reactionContent = (value: unknown): IssueReaction["content"] | null => {
  switch (value) {
    case "+1":
      return "thumbs-up";
    case "-1":
      return "thumbs-down";
    case "laugh":
      return "laugh";
    case "hooray":
      return "hooray";
    case "confused":
      return "confused";
    case "heart":
      return "heart";
    case "rocket":
      return "rocket";
    case "eyes":
      return "eyes";
    default:
      return null;
  }
};

const reactions = (raw: unknown, viewer?: string): ReadonlyArray<IssueReaction> => {
  const grouped = new Map<
    IssueReaction["content"],
    { readonly count: number; readonly actors: ReadonlyArray<string> }
  >();
  for (const entry of arrayValue(record(raw).nodes)) {
    const content = reactionContent(record(entry).content);
    if (content === null) continue;
    const previous = grouped.get(content) ?? { count: 0, actors: [] };
    const login = stringValue(record(record(entry).user).login).trim();
    grouped.set(content, {
      count: previous.count + 1,
      actors: login.length > 0 ? [...previous.actors, login] : previous.actors,
    });
  }
  return [...grouped.entries()].map(([content, value]) => ({
    content,
    count: value.count,
    actors: [...value.actors],
    viewerHasReacted: viewer !== undefined && value.actors.includes(viewer),
  }));
};

/** Normalize one GitHub GraphQL issue into the stable wire DTO. */
export function normalizeIssue(
  raw: unknown,
  context: IssueNormalizationContext,
): NormalizedIssue | null {
  const value = record(raw);
  const number = positiveInteger(value.number);
  if (number === null) return null;
  const titleValue = stringValue(value.title).trim();
  const title = (titleValue.length > 0 ? titleValue : `Issue #${number}`).slice(0, 256);
  const state = value.state === "CLOSED" || value.state === "closed" ? "closed" : "open";
  const stateReason =
    value.stateReason === "COMPLETED" || value.stateReason === "completed"
      ? "completed"
      : value.stateReason === "NOT_PLANNED" || value.stateReason === "not_planned"
        ? "not-planned"
        : value.stateReason === "DUPLICATE" || value.stateReason === "duplicate"
          ? "duplicate"
          : null;
  const urlValue = stringValue(value.url).trim();
  return {
    provider: "github",
    host: context.host,
    projectId: context.projectId,
    repository: context.repository,
    number,
    title,
    url: urlValue.length > 0 ? urlValue : issueUrl(context.host, context.repository, number),
    author: actor(value.author),
    state,
    labels: labels(value.labels),
    commentsCount: nonNegativeInteger(record(value.comments).totalCount),
    createdAt: iso(value.createdAt),
    updatedAt: iso(value.updatedAt),
    closedAt: value.closedAt === null || value.closedAt === undefined ? null : iso(value.closedAt),
    body: stringValue(value.body),
    stateReason,
    assignees: arrayValue(record(value.assignees).nodes).flatMap((entry) => {
      const value = actor(entry);
      return value === null ? [] : [value];
    }),
    milestone: milestone(value.milestone),
    reactions: reactions(value.reactions),
  };
}

/** Build the stable, filesystem-safe fragment used by issue worktrees. */
export function issueWorktreeFragment(number: number, name: string): string {
  return sanitizeBranchFragment(`${number}-${name}`).replaceAll("/", "-").replace(/-+/gu, "-");
}

/** Build the branch name used by issue worktrees before collision suffixing. */
export function issueWorktreeBranch(
  number: number,
  name: string,
  suffix?: number,
  prefix: string = DEFAULT_WORKTREE_BRANCH_PREFIX,
): string {
  const fragment = issueWorktreeFragment(number, name);
  const suffixFragment = suffix === undefined || suffix <= 1 ? fragment : `${fragment}-${suffix}`;
  return `${prefix}/${suffixFragment}`;
}

/** Compare worktree paths without allowing a trailing separator to bypass checks. */
export function isSafeIssueWorktreePath(input: {
  readonly projectRoot: string;
  readonly attachedPath: string;
  readonly requestedPath: string;
}): boolean {
  const normalize = (value: string): string => {
    const replaced = value.trim().replaceAll("\\", "/");
    const withoutTrailingSeparators = replaced.replace(/\/+$/, "");
    return withoutTrailingSeparators.length > 0 ? withoutTrailingSeparators : "/";
  };
  const projectRoot = normalize(input.projectRoot);
  const attachedPath = normalize(input.attachedPath);
  const requestedPath = normalize(input.requestedPath);
  return attachedPath !== projectRoot && requestedPath === attachedPath;
}

const commentFrom = (raw: unknown): IssueComment | null => {
  const value = record(raw);
  const id = stringValue(value.databaseId, stringValue(value.id)).trim();
  if (id.length === 0) return null;
  return {
    id,
    author: actor(value.author ?? value.user),
    body: stringValue(value.body),
    createdAt: iso(value.createdAt),
    ...(typeof value.updatedAt === "string" && value.updatedAt.trim().length > 0
      ? { updatedAt: iso(value.updatedAt) }
      : {}),
    url: typeof value.url === "string" ? value.url : null,
    reactions: reactions(value.reactions),
  };
};

const templateList = (value: unknown): ReadonlyArray<string> =>
  arrayValue(value).flatMap((entry) => {
    const item = record(entry);
    const type = stringValue(item.type);
    const file = stringValue(item.path).trim();
    if (type !== "file" || file.length === 0) return [];
    if (file.endsWith("config.yml") || file.endsWith("config.yaml")) return [];
    if (!file.endsWith(".md") && !file.endsWith(".yaml") && !file.endsWith(".yml")) return [];
    return [file];
  });

const hasDirectory = (entries: ReadonlyArray<unknown>, name: string): boolean =>
  entries.some((entry) => {
    const value = record(entry);
    return stringValue(value.type).trim() === "dir" && stringValue(value.name).trim() === name;
  });

const yamlList = (value: unknown): ReadonlyArray<string> => {
  if (Array.isArray(value)) {
    return value.map((entry) => stringValue(entry).trim()).filter((entry) => entry.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return [];
};

const parseTemplate = (raw: string, file: string): IssueTemplate => {
  const kind = file.endsWith(".md") ? "markdown" : "issue-form";
  let front: JsonRecord = {};
  let body = raw;
  if (raw.startsWith("---")) {
    const end = raw.indexOf("\n---", 3);
    if (end > 0) {
      try {
        front = record(parseYaml(raw.slice(3, end)));
      } catch {
        front = {};
      }
      body = raw.slice(end + 5).replace(/^\r?\n/, "");
    }
  }
  const stem = file.replace(/\.[^.]+$/, "");
  const nameValue = stringValue(front.name).trim();
  return {
    id: file,
    name: nameValue.length > 0 ? nameValue : stem.length > 0 ? stem : file,
    description: typeof front.description === "string" ? front.description : null,
    kind,
    ...(typeof front.title === "string" ? { title: front.title } : {}),
    ...(body.length > 0 ? { body } : {}),
    labels: yamlList(front.labels),
    assignees: yamlList(front.assignees),
  };
};

export const matchesFilters = (entry: NormalizedIssue, input: IssueListInput): boolean => {
  const filters = input.filters;
  if (!filters) return true;
  const names = new Set(entry.labels.map((label) => label.name.toLowerCase()));
  if (filters.excludedLabels?.some((label) => names.has(label.toLowerCase()))) return false;
  if (filters.labels?.some((group) => !group.some((label) => names.has(label.toLowerCase())))) {
    return false;
  }
  if (
    filters.author !== undefined &&
    entry.author?.login.toLowerCase() !== filters.author.toLowerCase()
  ) {
    return false;
  }
  if (
    filters.assignee !== undefined &&
    !entry.assignees.some(
      (assignee) => assignee.login.toLowerCase() === filters.assignee?.toLowerCase(),
    )
  ) {
    return false;
  }
  if (
    filters.milestone !== undefined &&
    entry.milestone?.title.toLowerCase() !== filters.milestone.toLowerCase()
  ) {
    return false;
  }
  return true;
};

export class IssueService extends Context.Service<
  IssueService,
  {
    readonly list: (input: IssueListInput) => Effect.Effect<IssueListResult, IssueError>;
    readonly detail: (input: IssueRef) => Effect.Effect<IssueDetail, IssueError>;
    readonly comments: (
      input: IssueCommentsInput,
    ) => Effect.Effect<IssueCommentsResult, IssueError>;
    readonly candidates: (
      input: IssueCandidatesInput,
    ) => Effect.Effect<IssueCandidatesResult, IssueError>;
    readonly templates: (
      input: IssueTemplatesInput,
    ) => Effect.Effect<IssueTemplatesResult, IssueError>;
    readonly create: (input: IssueCreateInput) => Effect.Effect<IssueCreateResult, IssueError>;
    readonly update: (input: IssueUpdateInput) => Effect.Effect<IssueUpdateResult, IssueError>;
    readonly commentCreate: (
      input: IssueCommentCreateInput,
    ) => Effect.Effect<IssueCommentCreateResult, IssueError>;
    readonly commentUpdate: (
      input: IssueCommentUpdateInput,
    ) => Effect.Effect<IssueCommentUpdateResult, IssueError>;
    readonly commentDelete: (input: IssueCommentDeleteInput) => Effect.Effect<void, IssueError>;
    readonly reactionUpdate: (input: IssueReactionUpdateInput) => Effect.Effect<void, IssueError>;
    readonly close: (input: IssueCloseInput) => Effect.Effect<IssueCloseResult, IssueError>;
    readonly reopen: (input: IssueReopenInput) => Effect.Effect<IssueReopenResult, IssueError>;
    readonly invalidate: (input: IssueInvalidateInput) => Effect.Effect<void>;
    readonly link: (input: IssueLinkInput) => Effect.Effect<IssueLinkResult, IssueError>;
    readonly worktreePrepare: (
      input: IssueWorktreePrepareInput,
    ) => Effect.Effect<IssueWorktreePrepareResult, IssueError>;
    readonly worktreeDeletePreflight: (
      input: IssueWorktreeDeletePreflightInput,
    ) => Effect.Effect<IssueWorktreeDeletePreflightResult, IssueError>;
    readonly worktreeDelete: (
      input: IssueWorktreeDeleteInput,
    ) => Effect.Effect<IssueWorktreeDeleteResult, IssueError>;
    readonly worktreeReplace: (
      input: IssueWorktreeReplaceInput,
    ) => Effect.Effect<IssueWorktreeReplaceResult, IssueError>;
    readonly authStatus: (
      input: IssueAuthStatusInput,
    ) => Effect.Effect<IssueAuthStatus, IssueError>;
    readonly authStart: (input: IssueAuthStartInput) => Effect.Effect<IssueAuthStatus, IssueError>;
    readonly authCancel: (
      input: IssueAuthCancelInput,
    ) => Effect.Effect<IssueAuthStatus, IssueError>;
  }
>()("t3/issue/IssueService") {}

export const make = Effect.gen(function* () {
  const gh = yield* GitHubCli.GitHubCli;
  const projections = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const git = yield* GitWorkflowService.GitWorkflowService;
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const worktreeRuns = yield* WorktreeRunManager.WorktreeRunManager;

  const listCache = new Map<string, CacheEntry<IssueListResult>>();
  const detailCache = new Map<string, CacheEntry<IssueDetail>>();
  const commentsCache = new Map<string, CacheEntry<IssueCommentsResult>>();
  const templatesCache = new Map<string, CacheEntry<IssueTemplatesResult>>();
  const maxCacheEntries = 256;
  const flows = new Map<string, AuthFlow>();
  let flowSequence = 0;
  let commandSequence = 0;

  const operationError = (
    operation: string,
    detail: string,
    cause?: unknown,
  ): IssueOperationError => {
    const normalized = detail.trim();
    return new IssueOperationError({
      operation,
      detail: normalized.length > 0 ? normalized : "GitHub operation failed.",
      ...(cause === undefined ? {} : { cause }),
    });
  };

  const mapCliError = (
    operation: string,
    host: string,
    error: GitHubCli.GitHubCliError,
  ): IssueError => {
    if (error._tag === "GitHubCliUnavailableError") {
      return new IssueUnavailableError({
        reason: "cli-missing",
        provider: "github",
        host,
        cause: error,
      });
    }
    if (error._tag === "GitHubCliAuthenticationError") {
      return new IssueUnavailableError({
        reason: "cli-unauthenticated",
        provider: "github",
        host,
        cause: error,
      });
    }
    const detail =
      error._tag === "GitHubCliRateLimitError"
        ? error.detail
        : error._tag === "GitHubPullRequestNotFoundError"
          ? "GitHub resource was not found. Check the repository and try again."
          : error._tag === "GitHubCliCommandError"
            ? "GitHub request failed. Check repository access and try again."
            : "GitHub returned an invalid response. Retry the operation.";
    return operationError(operation, detail, error);
  };

  const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
  const parseOutput = (
    operation: string,
    output: { readonly stdout: string },
  ): Effect.Effect<unknown, IssueOperationError> => {
    const text = output.stdout.trim();
    if (text.length === 0) return Effect.succeed(null);
    return decodeJson(text).pipe(
      Effect.mapError((cause) => operationError(operation, "GitHub returned invalid JSON.", cause)),
    );
  };

  const rest = (
    repo: Repo,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    endpoint: string,
    body?: JsonRecord,
  ): Effect.Effect<unknown, IssueError> => {
    const args = [
      "api",
      ...(method === "GET" ? [] : ["--method", method]),
      "--hostname",
      repo.host,
      endpoint,
      ...(body === undefined ? [] : ["--input", "-"]),
    ];
    return gh
      .execute({
        cwd: repo.cwd,
        args,
        ...(body === undefined ? {} : { stdin: JSON.stringify(body) }),
      })
      .pipe(
        Effect.mapError((error) => mapCliError(`rest.${method.toLowerCase()}`, repo.host, error)),
        Effect.flatMap((output) => parseOutput(`rest.${method.toLowerCase()}`, output)),
      );
  };
  const repositoryContents = (
    repo: Repo,
    endpoint: string,
    operation: string,
  ): Effect.Effect<ReadonlyArray<unknown>, IssueError> =>
    rest(repo, "GET", endpoint).pipe(
      Effect.flatMap((value) =>
        Array.isArray(value)
          ? Effect.succeed(value)
          : Effect.fail(
              operationError(operation, "GitHub returned an invalid repository contents response."),
            ),
      ),
    );

  const graph = (
    repo: Repo,
    query: string,
    variables: JsonRecord,
  ): Effect.Effect<JsonRecord, IssueError> =>
    gh
      .execute({
        cwd: repo.cwd,
        args: ["api", "graphql", "--hostname", repo.host, "--input", "-"],
        stdin: JSON.stringify({ query, variables }),
      })
      .pipe(
        Effect.mapError((error) => mapCliError("graphql", repo.host, error)),
        Effect.flatMap((output) => parseOutput("graphql", output)),
        Effect.flatMap((value) => {
          const response = record(value);
          const errors = arrayValue(response.errors);
          if (errors.length > 0) {
            const first = record(errors[0]);
            return Effect.fail(
              operationError(
                "graphql",
                stringValue(first.message, "GitHub GraphQL request failed."),
              ),
            );
          }
          return Effect.succeed(response);
        }),
      );

  const repoFor = (
    selection: IssueRepositorySelection | IssueRef,
  ): Effect.Effect<Repo, IssueError> =>
    projections.getProjectShellById(selection.projectId).pipe(
      Effect.mapError((cause) =>
        operationError("project.resolve", "Unable to resolve project.", cause),
      ),
      Effect.flatMap((maybe): Effect.Effect<Repo, IssueError> => {
        if (Option.isNone(maybe)) {
          return Effect.fail(operationError("project.resolve", "Project was not found."));
        }
        const project = maybe.value;
        const identity = project.repositoryIdentity;
        const provider = identity?.provider;
        if (
          provider !== undefined &&
          provider !== null &&
          provider !== "github" &&
          provider !== "unknown"
        ) {
          return Effect.fail(
            new IssueUnavailableError({ reason: "provider-unsupported", provider: "github" }),
          );
        }
        if (identity === undefined || identity === null) {
          return Effect.fail(
            new IssueUnavailableError({ reason: "provider-unsupported", provider: "github" }),
          );
        }
        const host = normalizeHost(
          selection.host ?? hostFromRemoteUrl(identity.locator.remoteUrl) ?? "github.com",
        );
        if (!validHost(host)) {
          return Effect.fail(operationError("project.resolve", "Repository host is invalid."));
        }
        const repository = selection.repository.trim();
        if (splitRepository(repository) === null) {
          return Effect.fail(operationError("project.resolve", "Repository must be owner/name."));
        }
        return Effect.succeed({
          projectId: project.id,
          host,
          repository,
          cwd: project.workspaceRoot,
          projectTitle: project.title,
        });
      }),
    );

  const cached = <Value>(
    cache: Map<string, CacheEntry<Value>>,
    key: string,
    ttlMs: number,
    effect: Effect.Effect<Value, IssueError>,
  ): Effect.Effect<Value, IssueError> =>
    Effect.gen(function* () {
      const currentTime = yield* Clock.currentTimeMillis;
      const hit = cache.get(key);
      if (hit !== undefined && currentTime - hit.at < ttlMs) return hit.value;
      if (hit !== undefined) cache.delete(key);
      const value = yield* effect;
      const at = yield* Clock.currentTimeMillis;
      cache.set(key, { at, value });
      while (cache.size > maxCacheEntries) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey === undefined) break;
        cache.delete(oldestKey);
      }
      return value;
    });

  const findLinked = (
    host: string,
    repository: string,
    number: number,
  ): Effect.Effect<IssueLinkRow | null, IssueOperationError> =>
    sql<IssueLinkRow>`
      SELECT
        thread_id AS "threadId",
        project_id AS "projectId",
        branch,
        worktree_path AS "worktreePath",
        linked_at AS "linkedAt",
        source,
        detached_at AS "detachedAt"
      FROM projection_issue_links
      WHERE host = ${host} AND repository = ${repository} AND number = ${number}
      LIMIT 1
    `.pipe(
      Effect.map((rows) => rows[0] ?? null),
      Effect.mapError((cause) => operationError("link.read", "Unable to read issue links.", cause)),
    );

  const findDetached = (
    threadId: ThreadIdType,
  ): Effect.Effect<DetachedWorkspaceRow | null, IssueOperationError> =>
    sql<DetachedWorkspaceRow>`
      SELECT
        thread_id AS "threadId",
        project_id AS "projectId",
        branch,
        worktree_path AS "worktreePath",
        detached_at AS "detachedAt"
      FROM projection_issue_detached_workspaces
      WHERE thread_id = ${threadId}
      LIMIT 1
    `.pipe(
      Effect.map((rows) => rows[0] ?? null),
      Effect.mapError((cause) =>
        operationError("worktree.detached.read", "Unable to read detached workspace state.", cause),
      ),
    );

  const getRepos = (input: IssueListInput): Effect.Effect<ReadonlyArray<Repo>, IssueError> =>
    Effect.gen(function* () {
      const explicit =
        input.repositories ?? (input.repository === undefined ? [] : [input.repository]);
      let repos: ReadonlyArray<Repo>;
      if (explicit.length > 0) {
        repos = yield* Effect.forEach(explicit, (selection) =>
          repoFor({ ...selection, ...(input.host === undefined ? {} : { host: input.host }) }),
        );
      } else {
        const projectIds =
          input.projectIds ?? (input.projectId === undefined ? undefined : [input.projectId]);
        const projects = yield* projections
          .getProjectShells(projectIds)
          .pipe(
            Effect.mapError((cause) =>
              operationError("project.resolve", "Unable to resolve projects.", cause),
            ),
          );
        repos = yield* Effect.forEach(projects, (project) => {
          const identity = project.repositoryIdentity;
          const provider = identity?.provider;
          if (
            identity === undefined ||
            identity === null ||
            (provider !== undefined &&
              provider !== null &&
              provider !== "github" &&
              provider !== "unknown")
          ) {
            return Effect.succeed<Repo | null>(null);
          }
          const repository =
            identity.owner && identity.name
              ? `${identity.owner}/${identity.name}`
              : identity.canonicalKey.split("/").slice(1).join("/");
          if (splitRepository(repository) === null) return Effect.succeed<Repo | null>(null);
          return repoFor({
            projectId: project.id,
            repository,
            ...(input.host === undefined ? {} : { host: input.host }),
          }).pipe(Effect.map((repo): Repo | null => repo));
        }).pipe(Effect.map((items) => items.flatMap((item) => (item === null ? [] : [item]))));
      }
      const seen = new Set<string>();
      return repos.filter((repo) => {
        const key = `${repo.projectId}:${repo.host}:${repo.repository.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });

  const sourceValue = (source: string): IssueLinkedWork["source"] => {
    if (source === "created" || source === "agent") return source;
    return "manual";
  };

  const linkedWorkFromRow = (repo: Repo, number: number, row: IssueLinkRow): IssueLinkedWork => ({
    issue: { provider: "github", host: repo.host, repository: repo.repository, number },
    threadId: ThreadId.make(row.threadId),
    projectId: ProjectId.make(row.projectId),
    branch: row.branch,
    worktreePath: row.worktreePath,
    linkedAt: iso(row.linkedAt),
    source: sourceValue(row.source),
  });

  const linkedWork = (
    repo: Repo,
    number: number,
  ): Effect.Effect<IssueLinkedWork | null, IssueOperationError> =>
    findLinked(repo.host, repo.repository, number).pipe(
      Effect.map((row) => (row === null ? null : linkedWorkFromRow(repo, number, row))),
    );

  const detail = (input: IssueRef): Effect.Effect<IssueDetail, IssueError> =>
    cached(
      detailCache,
      `detail:${JSON.stringify(input)}`,
      15_000,
      Effect.gen(function* () {
        const repo = yield* repoFor(input);
        const parsed = splitRepository(repo.repository);
        if (parsed === null)
          return yield* operationError("detail", "Repository must be owner/name.");
        const response = yield* graph(repo, DETAIL_QUERY, {
          owner: parsed.owner,
          name: parsed.name,
          number: input.number,
        });
        const repository = record(record(response.data).repository);
        const rawIssue = repository.issue;
        const issue = normalizeIssue(rawIssue, repo);
        if (issue === null) return yield* operationError("detail", "Issue was not found.");
        const viewer = stringValue(record(record(response.data).viewer).login).trim();
        const linked = yield* linkedWork(repo, input.number);
        return {
          ...issue,
          projectTitle: repo.projectTitle,
          workspaceRoot: repo.cwd,
          reactions: reactions(record(rawIssue).reactions, viewer.length > 0 ? viewer : undefined),
          ...(viewer.length > 0 ? { viewer } : {}),
          viewerPermissions: {
            comment: true,
            update: true,
            close: issue.state === "open",
            reopen: issue.state === "closed",
            react: true,
            link: true,
          },
          linkedWork: linked,
        };
      }),
    );

  const list = (input: IssueListInput): Effect.Effect<IssueListResult, IssueError> =>
    cached(
      listCache,
      `list:${JSON.stringify(input)}`,
      30_000,
      Effect.gen(function* () {
        const repos = yield* getRepos(input);
        const limit = input.limit ?? 99;
        const entries: Array<IssueListEntry> = [];
        const errors: Array<IssueListResult["errors"][number]> = [];
        const nextCursors: Record<string, string> = {};
        const grouped = new Map<string, ReadonlyArray<Repo>>();
        for (const repo of repos) {
          const previous = grouped.get(repo.host) ?? [];
          grouped.set(repo.host, [...previous, repo]);
        }
        const providers: IssueListResult["providers"] = [...grouped.entries()].map(
          ([host, hostRepos]) => ({
            provider: "github",
            host,
            searchesOnHost:
              input.query !== undefined ||
              (input.involvement !== undefined && input.involvement !== "all") ||
              hostRepos.length > 1,
            projectCount: new Set(hostRepos.map((repo) => repo.projectId)).size || 1,
            configured: true,
            detail: null,
          }),
        );
        const shouldSearch =
          input.query !== undefined ||
          (input.involvement !== undefined && input.involvement !== "all") ||
          repos.some((repo) =>
            repos.some((other) => other.host === repo.host && other.repository !== repo.repository),
          );
        const states = input.state === "all" ? null : [input.state === "open" ? "OPEN" : "CLOSED"];
        for (const repo of repos) {
          const parsed = splitRepository(repo.repository);
          if (parsed === null) {
            errors.push({
              projectId: repo.projectId,
              repository: repo.repository,
              message: "Repository must be owner/name.",
            });
            continue;
          }
          const cursorKey = `${repo.projectId}:${repo.host}:${repo.repository}`;
          const after = input.cursors?.[cursorKey] ?? null;
          const searchTerms = [
            `repo:${repo.repository}`,
            "is:issue",
            ...(input.state === "all" ? [] : [`state:${input.state}`]),
            ...(input.involvement === "authored" ? ["author:@me"] : []),
            ...(input.involvement === "assigned" ? ["assignee:@me"] : []),
            ...(input.involvement === "mentioned" ? ["mentions:@me"] : []),
            ...(input.query === undefined ? [] : [input.query]),
          ];
          const pageEffect = shouldSearch
            ? graph(repo, SEARCH_QUERY, {
                query: searchTerms.join(" "),
                first: Math.min(100, limit),
                after,
              })
            : graph(repo, LIST_QUERY, {
                owner: parsed.owner,
                name: parsed.name,
                first: Math.min(100, limit),
                after,
                states,
              });
          yield* pageEffect.pipe(
            Effect.matchEffect({
              onFailure: (error) =>
                Effect.sync(() => {
                  errors.push({
                    projectId: repo.projectId,
                    repository: repo.repository,
                    message: error.message,
                  });
                }),
              onSuccess: (response) =>
                Effect.sync(() => {
                  const data = record(response.data);
                  const container = shouldSearch
                    ? record(data.search)
                    : record(record(data.repository).issues);
                  for (const rawIssue of arrayValue(container.nodes)) {
                    const issue = normalizeIssue(rawIssue, repo);
                    if (issue !== null && matchesFilters(issue, input)) entries.push(issue);
                  }
                  const pageInfo = record(container.pageInfo);
                  const hasNext = pageInfo.hasNextPage === true;
                  const endCursor = stringValue(pageInfo.endCursor).trim();
                  if (hasNext && endCursor.length > 0) nextCursors[cursorKey] = endCursor;
                }),
            }),
          );
        }
        entries.sort((left, right) => {
          const updated = right.updatedAt.localeCompare(left.updatedAt);
          return updated !== 0
            ? updated
            : `${left.repository}#${left.number}`.localeCompare(
                `${right.repository}#${right.number}`,
              );
        });
        const truncated = entries.length > limit || Object.keys(nextCursors).length > 0;
        return {
          providers,
          entries: entries.slice(0, limit),
          errors,
          truncated,
          nextCursors,
        };
      }),
    );

  const comments = (input: IssueCommentsInput): Effect.Effect<IssueCommentsResult, IssueError> =>
    cached(
      commentsCache,
      `comments:${JSON.stringify(input)}`,
      15_000,
      Effect.gen(function* () {
        const repo = yield* repoFor(input);
        const parsed = splitRepository(repo.repository);
        if (parsed === null)
          return yield* operationError("comments", "Repository must be owner/name.");
        const response = yield* graph(repo, COMMENTS_QUERY, {
          owner: parsed.owner,
          name: parsed.name,
          number: input.number,
          first: Math.min(100, input.limit ?? 50),
          after: input.cursor ?? null,
        });
        const issue = record(record(record(response.data).repository).issue);
        const page = record(issue.comments);
        const pageInfo = record(page.pageInfo);
        const hasNext = pageInfo.hasNextPage === true;
        const endCursor = stringValue(pageInfo.endCursor).trim();
        return {
          comments: arrayValue(page.nodes).flatMap((raw) => {
            const comment = commentFrom(raw);
            return comment === null ? [] : [comment];
          }),
          nextCursor: hasNext && endCursor.length > 0 ? endCursor : null,
          commentCount: nonNegativeInteger(page.totalCount),
          truncated: hasNext && endCursor.length > 0,
        };
      }),
    );

  const mutationIssue = (
    repo: Repo,
    endpoint: string,
    method: "POST" | "PATCH",
    body: JsonRecord,
    input: IssueRef,
  ): Effect.Effect<IssueDetail, IssueError> =>
    rest(repo, method, endpoint, body).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          listCache.clear();
          detailCache.clear();
        }),
      ),
      Effect.flatMap(() => detail(input)),
    );

  const create = (input: IssueCreateInput): Effect.Effect<IssueCreateResult, IssueError> =>
    Effect.gen(function* () {
      const repo = yield* repoFor(input);
      let bodyText = input.body;
      if (input.templateId !== undefined) {
        const templateResult = yield* templates(input);
        const template = templateResult.templates.find((item) => item.id === input.templateId);
        if (template === undefined)
          return yield* operationError("create", "Issue template was not found.");
        if (template.body !== undefined && template.body.length > 0)
          bodyText = `${template.body}\n\n${bodyText}`;
      }
      const body: MutableJsonRecord = { title: input.title, body: bodyText };
      if (input.labels !== undefined) body.labels = input.labels;
      if (input.assignees !== undefined) body.assignees = input.assignees;
      if (input.milestone !== undefined) {
        if (!/^\d+$/.test(input.milestone)) {
          return yield* operationError(
            "create",
            "Milestone must be a numeric GitHub milestone id.",
          );
        }
        body.milestone = Number(input.milestone);
      }
      const result = record(yield* rest(repo, "POST", `repos/${repo.repository}/issues`, body));
      const number = positiveInteger(result.number);
      if (number === null)
        return yield* operationError("create", "GitHub did not return an issue number.");
      return { issue: yield* detail({ ...input, number }) };
    });

  const update = (input: IssueUpdateInput): Effect.Effect<IssueUpdateResult, IssueError> =>
    Effect.gen(function* () {
      const repo = yield* repoFor(input);
      const body: MutableJsonRecord = {};
      if (input.title !== undefined) body.title = input.title;
      if (input.body !== undefined) body.body = input.body;
      if (input.labels !== undefined) body.labels = input.labels;
      if (input.assignees !== undefined) body.assignees = input.assignees;
      if (input.milestone !== undefined) {
        if (input.milestone === null) body.milestone = null;
        else if (/^\d+$/.test(input.milestone)) body.milestone = Number(input.milestone);
        else
          return yield* operationError(
            "update",
            "Milestone must be a numeric GitHub milestone id.",
          );
      }
      return {
        issue: yield* mutationIssue(
          repo,
          `repos/${repo.repository}/issues/${input.number}`,
          "PATCH",
          body,
          input,
        ),
      };
    });

  const close = (input: IssueCloseInput): Effect.Effect<IssueCloseResult, IssueError> =>
    Effect.gen(function* () {
      const repo = yield* repoFor(input);
      const body: MutableJsonRecord = { state: "closed" };
      if (input.reason !== undefined) {
        body.state_reason = input.reason === "not-planned" ? "not_planned" : input.reason;
      }
      return {
        issue: yield* mutationIssue(
          repo,
          `repos/${repo.repository}/issues/${input.number}`,
          "PATCH",
          body,
          input,
        ),
      };
    });

  const reopen = (input: IssueReopenInput): Effect.Effect<IssueReopenResult, IssueError> =>
    Effect.gen(function* () {
      const repo = yield* repoFor(input);
      return {
        issue: yield* mutationIssue(
          repo,
          `repos/${repo.repository}/issues/${input.number}`,
          "PATCH",
          { state: "open" },
          input,
        ),
      };
    });

  const commentCreate = (
    input: IssueCommentCreateInput,
  ): Effect.Effect<IssueCommentCreateResult, IssueError> =>
    Effect.gen(function* () {
      const repo = yield* repoFor(input);
      const comment = commentFrom(
        yield* rest(repo, "POST", `repos/${repo.repository}/issues/${input.number}/comments`, {
          body: input.body,
        }),
      );
      if (comment === null)
        return yield* operationError("comment.create", "GitHub did not return a comment.");
      commentsCache.clear();
      detailCache.clear();
      return { comment };
    });

  const commentUpdate = (
    input: IssueCommentUpdateInput,
  ): Effect.Effect<IssueCommentUpdateResult, IssueError> =>
    Effect.gen(function* () {
      const repo = yield* repoFor(input);
      const comment = commentFrom(
        yield* rest(repo, "PATCH", `repos/${repo.repository}/issues/comments/${input.commentId}`, {
          body: input.body,
        }),
      );
      if (comment === null)
        return yield* operationError("comment.update", "GitHub did not return a comment.");
      commentsCache.clear();
      return { comment };
    });

  const commentDelete = (input: IssueCommentDeleteInput): Effect.Effect<void, IssueError> =>
    repoFor(input).pipe(
      Effect.flatMap((repo) =>
        rest(repo, "DELETE", `repos/${repo.repository}/issues/comments/${input.commentId}`).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              commentsCache.clear();
              detailCache.clear();
            }),
          ),
          Effect.asVoid,
        ),
      ),
    );
  const reactionUpdate = (input: IssueReactionUpdateInput): Effect.Effect<void, IssueError> =>
    Effect.gen(function* () {
      const repo = yield* repoFor(input);
      const subject =
        input.subjectId === undefined ? String(input.number) : `comments/${input.subjectId}`;
      const collection = `repos/${repo.repository}/issues/${subject}/reactions`;
      if (input.reacted) {
        yield* rest(repo, "POST", collection, { content: REACTION_CONTENT[input.content] });
      } else {
        const viewer = stringValue(record(yield* rest(repo, "GET", "user")).login).trim();
        const reaction = arrayValue(yield* rest(repo, "GET", `${collection}?per_page=100`)).find(
          (entry) => {
            const value = record(entry);
            return (
              reactionContent(value.content) === input.content &&
              stringValue(record(value.user).login) === viewer
            );
          },
        );
        const reactionId = positiveInteger(record(reaction).id);
        if (reactionId === null) {
          return yield* operationError(
            "reaction.delete",
            "The current user's reaction was not found.",
          );
        }
        yield* rest(repo, "DELETE", `reactions/${reactionId}`);
      }
      detailCache.clear();
      commentsCache.clear();
    });

  const candidates = (
    input: IssueCandidatesInput,
  ): Effect.Effect<IssueCandidatesResult, IssueError> =>
    Effect.gen(function* () {
      const repo = yield* repoFor(input);
      const result = yield* rest(
        repo,
        "GET",
        `repos/${repo.repository}/${input.kind === "labels" ? "labels" : "assignees"}?per_page=100`,
      );
      const query = input.query?.toLowerCase() ?? "";
      if (input.kind === "labels") {
        return {
          _tag: "labels",
          candidates: arrayValue(result)
            .flatMap((entry) => {
              const value = record(entry);
              const name = stringValue(value.name).trim();
              if (name.length === 0 || !name.toLowerCase().includes(query)) return [];
              return [
                {
                  name,
                  color: typeof value.color === "string" ? value.color : null,
                  ...(typeof value.description === "string"
                    ? { description: value.description }
                    : {}),
                },
              ];
            })
            .slice(0, input.limit ?? 50),
        };
      }
      return {
        _tag: "assignees",
        candidates: arrayValue(result)
          .flatMap((entry) => {
            const value = actor(entry);
            return value !== null && value.login.toLowerCase().includes(query) ? [value] : [];
          })
          .slice(0, input.limit ?? 50),
      };
    });

  const templates = (input: IssueTemplatesInput): Effect.Effect<IssueTemplatesResult, IssueError> =>
    cached(
      templatesCache,
      `templates:${JSON.stringify(input)}`,
      300_000,
      Effect.gen(function* () {
        const repo = yield* repoFor(input);
        // Probe parent listings first so a missing optional directory is not confused with
        // repository authentication or permission failures from the contents API.
        const rootEntries = yield* repositoryContents(
          repo,
          `repos/${repo.repository}/contents`,
          "templates.root",
        );
        if (!hasDirectory(rootEntries, ".github")) return { templates: [] };
        const githubEntries = yield* repositoryContents(
          repo,
          `repos/${repo.repository}/contents/.github`,
          "templates.github",
        );
        if (!hasDirectory(githubEntries, "ISSUE_TEMPLATE")) return { templates: [] };
        const entries = yield* repositoryContents(
          repo,
          `repos/${repo.repository}/contents/.github/ISSUE_TEMPLATE`,
          "templates.directory",
        );
        const templates: IssueTemplate[] = [];
        for (const file of templateList(entries)) {
          const contentValue = yield* rest(
            repo,
            "GET",
            `repos/${repo.repository}/contents/${file}`,
          );
          if (!isRecord(contentValue)) {
            return yield* operationError(
              "templates.file",
              "GitHub returned an invalid issue template response.",
            );
          }
          const content = contentValue;
          const encoded = stringValue(content.content).replaceAll("\n", "");
          let raw = stringValue(content.content);
          if (stringValue(content.encoding) === "base64" && encoded.length > 0) {
            raw = Buffer.from(encoded, "base64").toString("utf8");
          }
          templates.push(parseTemplate(raw, file));
        }
        return { templates };
      }),
    );

  const dispatchWorkspace = (
    threadId: ThreadIdType,
    branch: string | null,
    worktreePath: string | null,
    operation: string,
  ): Effect.Effect<void, IssueError> =>
    Effect.gen(function* () {
      const currentTime = yield* Clock.currentTimeMillis;
      yield* engine
        .dispatch({
          type: "thread.meta.update",
          commandId: CommandId.make(`issue-${operation}-${++commandSequence}-${currentTime}`),
          threadId,
          branch,
          worktreePath,
        })
        .pipe(
          Effect.mapError((cause) =>
            operationError(`worktree.${operation}`, "Unable to update thread workspace.", cause),
          ),
          Effect.asVoid,
        );
    });
  const persistLink = (
    input: IssueLinkInput,
    repo: Repo,
    threadId: ThreadIdType,
    branch: string | null,
    worktreePath: string | null,
    source: IssueLinkedWork["source"],
  ): Effect.Effect<IssueLinkedWork, IssueError> =>
    Effect.gen(function* () {
      const linkedAt = DateTime.formatIso(yield* DateTime.now);
      const linkedWork: IssueLinkedWork = {
        issue: {
          provider: "github",
          host: repo.host,
          repository: repo.repository,
          number: input.number,
        },
        threadId,
        projectId: input.projectId,
        branch,
        worktreePath,
        linkedAt,
        source,
      };
      yield* sql`
        INSERT INTO projection_issue_links (
          thread_id, project_id, host, repository, number, source, linked_at,
          branch, worktree_path, detached_at
        ) VALUES (
          ${threadId}, ${input.projectId}, ${repo.host}, ${repo.repository}, ${input.number},
          ${source}, ${linkedAt}, ${branch}, ${worktreePath}, NULL
        )
        ON CONFLICT(thread_id) DO UPDATE SET
          project_id = excluded.project_id,
          host = excluded.host,
          repository = excluded.repository,
          number = excluded.number,
          source = excluded.source,
          linked_at = excluded.linked_at,
          branch = excluded.branch,
          worktree_path = excluded.worktree_path,
          detached_at = NULL
      `.pipe(
        Effect.mapError((cause) =>
          operationError("link.write", "Unable to save issue link.", cause),
        ),
      );
      return linkedWork;
    });

  const link = (input: IssueLinkInput): Effect.Effect<IssueLinkResult, IssueError> =>
    Effect.gen(function* () {
      const repo = yield* repoFor(input);
      const thread = yield* projections.getThreadShellById(input.threadId).pipe(
        Effect.mapError((cause) => operationError("link", "Unable to resolve thread.", cause)),
        Effect.map(Option.getOrUndefined),
      );
      if (thread === undefined || thread.projectId !== input.projectId) {
        return yield* operationError("link", "Thread does not belong to this project.");
      }
      return {
        linkedWork: yield* persistLink(
          input,
          repo,
          input.threadId,
          thread.branch,
          thread.worktreePath,
          input.source ?? "manual",
        ),
      };
    });

  const resolveBaseBranch = (
    repo: Repo,
    base: string | undefined,
  ): Effect.Effect<string, IssueError> => {
    if (base !== undefined && base.trim().length > 0) return Effect.succeed(base.trim());
    return git.localStatus({ cwd: repo.cwd }).pipe(
      Effect.map((status) => status.refName ?? "main"),
      Effect.mapError((cause) =>
        operationError("worktree.base", "Unable to resolve base branch.", cause),
      ),
    );
  };

  const collectRefs = (repo: Repo): Effect.Effect<ReadonlyArray<string>, IssueError> =>
    Effect.gen(function* () {
      const names: string[] = [];
      let cursor: number | null = null;
      for (let page = 0; page < 100; page += 1) {
        const result: VcsListRefsResult = yield* git
          .listRefs({
            cwd: repo.cwd,
            refKind: "all",
            limit: 200,
            ...(cursor === null ? {} : { cursor }),
          })
          .pipe(
            Effect.mapError((cause) =>
              operationError("worktree.refs", "Unable to inspect repository refs.", cause),
            ),
          );
        names.push(...result.refs.map((ref) => ref.name));
        if (result.nextCursor === null || result.nextCursor === cursor) break;
        cursor = result.nextCursor;
      }
      return names;
    });

  const issueWorktree = (
    repo: Repo,
    input: IssueWorktreePrepareInput | IssueWorktreeReplaceInput,
  ): Effect.Effect<IssueWorktree, IssueError> =>
    Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings.pipe(
        Effect.mapError((cause) =>
          operationError("worktree.settings", "Unable to read worktree settings.", cause),
        ),
      );
      const worktreeBranchPrefix = settings.worktreeBranchPrefix;
      const baseBranch = yield* resolveBaseBranch(repo, input.baseBranch);
      const issue = yield* detail(input);
      const refs = yield* collectRefs(repo);
      const existingBranches = new Set(refs.map((ref) => ref.toLowerCase()));
      const baseFragment = issueWorktreeFragment(input.number, input.name);
      const basePath = path.join(config.worktreesDir, path.basename(repo.cwd), baseFragment);
      let suffix = 1;
      let branch = issueWorktreeBranch(input.number, input.name, undefined, worktreeBranchPrefix);
      let worktreePath = basePath;
      let pathExists = yield* fs
        .exists(worktreePath)
        .pipe(
          Effect.mapError((cause) =>
            operationError("worktree.create", "Unable to inspect worktree path.", cause),
          ),
        );
      while (existingBranches.has(branch.toLowerCase()) || pathExists) {
        suffix += 1;
        branch = issueWorktreeBranch(input.number, input.name, suffix, worktreeBranchPrefix);
        worktreePath = path.join(
          config.worktreesDir,
          path.basename(repo.cwd),
          `${baseFragment}-${suffix}`,
        );
        if (suffix > 10_000) {
          return yield* operationError(
            "worktree.create",
            "Unable to find an unused issue worktree name.",
          );
        }
        pathExists = yield* fs
          .exists(worktreePath)
          .pipe(
            Effect.mapError((cause) =>
              operationError("worktree.create", "Unable to inspect worktree path.", cause),
            ),
          );
      }
      yield* git
        .createWorktree({
          cwd: repo.cwd,
          refName: baseBranch,
          newRefName: branch,
          baseRefName: baseBranch,
          path: worktreePath,
        })
        .pipe(
          Effect.mapError((cause) =>
            operationError("worktree.create", "Unable to create issue worktree.", cause),
          ),
        );
      return {
        projectId: repo.projectId,
        issue: {
          provider: "github",
          host: repo.host,
          repository: repo.repository,
          number: input.number,
        },
        name: input.name,
        branch,
        worktreePath,
        baseBranch,
      };
    });

  const clearDetached = (threadId: ThreadIdType): Effect.Effect<void, IssueError> =>
    sql`DELETE FROM projection_issue_detached_workspaces WHERE thread_id = ${threadId}`.pipe(
      Effect.mapError((cause) =>
        operationError("worktree.attach", "Unable to clear detached workspace state.", cause),
      ),
      Effect.asVoid,
    );

  const worktreePrepare = (
    input: IssueWorktreePrepareInput,
  ): Effect.Effect<IssueWorktreePrepareResult, IssueError> =>
    Effect.gen(function* () {
      if (input.threadId !== undefined) {
        const thread = yield* projections.getThreadShellById(input.threadId).pipe(
          Effect.mapError((cause) =>
            operationError("worktree.prepare", "Unable to resolve thread.", cause),
          ),
          Effect.map(Option.getOrUndefined),
        );
        if (thread === undefined || thread.projectId !== input.projectId) {
          return yield* operationError(
            "worktree.prepare",
            "Thread does not belong to this project.",
          );
        }
      }
      const repo = yield* repoFor(input);
      const worktree = yield* issueWorktree(repo, input);
      let linkedWork: IssueLinkedWork | null = null;
      if (input.threadId !== undefined) {
        yield* dispatchWorkspace(input.threadId, worktree.branch, worktree.worktreePath, "prepare");
        linkedWork = yield* persistLink(
          { ...input, threadId: input.threadId },
          repo,
          input.threadId,
          worktree.branch,
          worktree.worktreePath,
          "created",
        );
        yield* clearDetached(input.threadId);
      }
      return { worktree, linkedWork };
    });

  const preflightItem = (
    selection: IssueWorktreeDeletePreflightInput["selections"][number],
  ): Effect.Effect<IssueWorktreeDeletePreflightItem, IssueError> =>
    Effect.gen(function* () {
      const [thread, project] = yield* Effect.all([
        projections.getThreadShellById(selection.threadId).pipe(
          Effect.mapError((cause) =>
            operationError("worktree.deletePreflight", "Unable to resolve thread.", cause),
          ),
          Effect.map(Option.getOrUndefined),
        ),
        projections.getProjectShellById(selection.projectId).pipe(
          Effect.mapError((cause) =>
            operationError("worktree.deletePreflight", "Unable to resolve project.", cause),
          ),
          Effect.map(Option.getOrUndefined),
        ),
      ]);
      const branch = thread?.branch ?? "unknown";
      const base = {
        threadId: selection.threadId,
        projectId: selection.projectId,
        path: selection.path,
        branch,
      };
      const blocked = (
        reason: string,
        activeAgent: string | null = null,
      ): IssueWorktreeDeletePreflightItem => ({
        ...base,
        activeAgent,
        blocked: true,
        changedFiles: [],
        unpushedCommitCount: 0,
        canDelete: false,
        requiresForce: false,
        reason,
      });
      if (thread === undefined || project === undefined)
        return blocked("Thread or project was not found.");
      if (thread.projectId !== selection.projectId)
        return blocked("Thread does not belong to this project.");
      if (thread.worktreePath === null) return blocked("Thread has no attached worktree.");
      const projectRoot = path.resolve(project.workspaceRoot);
      const attachedPath = path.resolve(thread.worktreePath);
      const requestedPath = path.resolve(selection.path);
      if (
        !isSafeIssueWorktreePath({
          projectRoot,
          attachedPath,
          requestedPath,
        })
      ) {
        return blocked("The requested path is not the thread's attached worktree.");
      }
      const exists = yield* fs.exists(attachedPath).pipe(
        Effect.matchEffect({
          onFailure: () => Effect.succeed(false),
          onSuccess: (value) => Effect.succeed(value),
        }),
      );
      if (!exists) return blocked("The worktree path does not exist.");
      const rootReal = yield* fs.realPath(projectRoot).pipe(Effect.option);
      const attachedReal = yield* fs.realPath(attachedPath).pipe(Effect.option);
      if (
        Option.isSome(rootReal) &&
        Option.isSome(attachedReal) &&
        rootReal.value === attachedReal.value
      ) {
        return blocked("The requested path resolves to the project checkout.");
      }
      const activeAgent =
        thread.session !== null &&
        (thread.session.status === "starting" || thread.session.status === "running")
          ? (thread.session.providerName ?? "provider")
          : null;
      const local = yield* git.localStatus({ cwd: attachedPath }).pipe(
        Effect.matchEffect({
          onFailure: () => Effect.succeed(null),
          onSuccess: (value) => Effect.succeed(value),
        }),
      );
      if (local === null)
        return blocked("Unable to inspect the worktree's Git status.", activeAgent);
      if (!local.isRepo) return blocked("The selected path is not a Git worktree.", activeAgent);
      let remoteFailed = false;
      const unpushedCommitCount = yield* git.remoteStatus({ cwd: attachedPath }).pipe(
        Effect.matchEffect({
          onFailure: () =>
            Effect.sync(() => {
              remoteFailed = true;
              return 0;
            }),
          onSuccess: (value) => Effect.succeed(value?.aheadCount ?? 0),
        }),
      );
      if (remoteFailed) {
        return blocked("Unable to inspect the worktree's remote status.", activeAgent);
      }
      const changedFiles = local.workingTree.files.slice(0, 1_000).map((file) => file.path);
      const requiresForce = changedFiles.length > 0 || unpushedCommitCount > 0;
      const reason =
        activeAgent !== null
          ? `Worktree is in use by ${activeAgent}.`
          : requiresForce
            ? "Worktree has changes or unpushed commits."
            : null;
      return {
        ...base,
        activeAgent,
        blocked: activeAgent !== null,
        changedFiles,
        unpushedCommitCount,
        canDelete: activeAgent === null && !requiresForce,
        requiresForce,
        reason,
      };
    });

  const worktreeDeletePreflight = (
    input: IssueWorktreeDeletePreflightInput,
  ): Effect.Effect<IssueWorktreeDeletePreflightResult, IssueError> =>
    Effect.forEach(input.selections, preflightItem).pipe(Effect.map((items) => ({ items })));

  const worktreeDelete = (
    input: IssueWorktreeDeleteInput,
  ): Effect.Effect<IssueWorktreeDeleteResult, IssueError> =>
    Effect.gen(function* () {
      const results: Array<IssueWorktreeDeleteResult["results"][number]> = [];
      for (const selection of input.selections) {
        const preflight = yield* preflightItem(selection);
        if (preflight.blocked) {
          results.push({
            threadId: selection.threadId,
            projectId: selection.projectId,
            path: selection.path,
            deleted: false,
            error: preflight.reason ?? "Worktree deletion is blocked.",
            detachedWorkspace: null,
          });
          continue;
        }
        if (preflight.requiresForce && !input.forceAcknowledged) {
          results.push({
            threadId: selection.threadId,
            projectId: selection.projectId,
            path: selection.path,
            deleted: false,
            error: "Force acknowledgement is required.",
            detachedWorkspace: null,
          });
          continue;
        }
        const project = yield* projections.getProjectShellById(selection.projectId).pipe(
          Effect.mapError((cause) =>
            operationError("worktree.delete", "Unable to resolve project.", cause),
          ),
          Effect.map(Option.getOrUndefined),
        );
        const thread = yield* projections.getThreadShellById(selection.threadId).pipe(
          Effect.mapError((cause) =>
            operationError("worktree.delete", "Unable to resolve thread.", cause),
          ),
          Effect.map(Option.getOrUndefined),
        );
        if (project === undefined || thread === undefined || thread.worktreePath === null) {
          results.push({
            threadId: selection.threadId,
            projectId: selection.projectId,
            path: selection.path,
            deleted: false,
            error: "Thread or worktree was not found.",
            detachedWorkspace: null,
          });
          continue;
        }
        const projectRoot = path.resolve(project.workspaceRoot);
        const attachedPath = path.resolve(thread.worktreePath);
        const requestedPath = path.resolve(selection.path);
        if (!isSafeIssueWorktreePath({ projectRoot, attachedPath, requestedPath })) {
          results.push({
            threadId: selection.threadId,
            projectId: selection.projectId,
            path: selection.path,
            deleted: false,
            error: "The requested path is not the thread's attached worktree.",
            detachedWorkspace: null,
          });
          continue;
        }
        const detachedAt = now();
        const detachedWorkspace = {
          threadId: selection.threadId,
          projectId: selection.projectId,
          branch: thread.branch,
          worktreePath: thread.worktreePath,
          detachedAt,
        };
        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`
              INSERT INTO projection_issue_detached_workspaces (
                thread_id, project_id, branch, worktree_path, detached_at
              ) VALUES (
                ${selection.threadId}, ${selection.projectId}, ${thread.branch}, ${thread.worktreePath}, ${detachedAt}
              )
              ON CONFLICT(thread_id) DO UPDATE SET
                project_id = excluded.project_id,
                branch = excluded.branch,
                worktree_path = excluded.worktree_path,
                detached_at = excluded.detached_at
            `;
              yield* sql`
              UPDATE projection_issue_links
              SET branch = NULL, worktree_path = NULL, detached_at = ${detachedAt}
              WHERE thread_id = ${selection.threadId}
            `;
            }),
          )
          .pipe(
            Effect.mapError((cause) =>
              operationError("worktree.delete", "Unable to save detached workspace state.", cause),
            ),
          );
        yield* dispatchWorkspace(selection.threadId, null, null, "delete");
        yield* worktreeRuns.stopWorkspace(attachedPath);
        const removed = yield* Effect.option(
          git.removeWorktree({
            cwd: projectRoot,
            path: attachedPath,
            force: input.forceAcknowledged,
          }),
        );
        if (Option.isNone(removed)) {
          yield* sql
            .withTransaction(
              Effect.gen(function* () {
                yield* sql`
                  UPDATE projection_issue_links
                  SET branch = ${thread.branch}, worktree_path = ${thread.worktreePath}, detached_at = NULL
                  WHERE thread_id = ${selection.threadId}
                `;
                yield* sql`
                  DELETE FROM projection_issue_detached_workspaces
                  WHERE thread_id = ${selection.threadId}
                `;
              }),
            )
            .pipe(
              Effect.mapError((cause) =>
                operationError(
                  "worktree.delete",
                  "Unable to restore issue worktree state after deletion failed.",
                  cause,
                ),
              ),
            );
          yield* dispatchWorkspace(
            selection.threadId,
            thread.branch,
            thread.worktreePath,
            "delete-restore",
          );
          results.push({
            threadId: selection.threadId,
            projectId: selection.projectId,
            path: selection.path,
            deleted: false,
            error: "Unable to delete worktree.",
            detachedWorkspace: null,
          });
          continue;
        }
        listCache.clear();
        detailCache.clear();
        commentsCache.clear();
        templatesCache.clear();
        results.push({
          threadId: selection.threadId,
          projectId: selection.projectId,
          path: selection.path,
          deleted: true,
          error: null,
          detachedWorkspace,
        });
      }
      return { results };
    });

  const worktreeReplace = (
    input: IssueWorktreeReplaceInput,
  ): Effect.Effect<IssueWorktreeReplaceResult, IssueError> =>
    Effect.gen(function* () {
      const repo = yield* repoFor(input);
      const existingLink = yield* findLinked(repo.host, repo.repository, input.number).pipe(
        Effect.mapError((cause) =>
          operationError("worktree.replace", "Unable to read issue link.", cause),
        ),
      );
      const targetThreadId =
        input.threadId ??
        (existingLink === null ? undefined : ThreadId.make(existingLink.threadId));
      const targetThread =
        targetThreadId === undefined
          ? undefined
          : yield* projections.getThreadShellById(targetThreadId).pipe(
              Effect.mapError((cause) =>
                operationError("worktree.replace", "Unable to resolve thread.", cause),
              ),
              Effect.map(Option.getOrUndefined),
            );
      if (
        targetThreadId !== undefined &&
        (targetThread === undefined || targetThread.projectId !== input.projectId)
      ) {
        return yield* operationError("worktree.replace", "Thread does not belong to this project.");
      }
      const oldPath = input.worktreePath?.trim();
      if (oldPath !== undefined) {
        const expectedPath = targetThread?.worktreePath ?? existingLink?.worktreePath;
        if (expectedPath === null || expectedPath === undefined) {
          return yield* operationError(
            "worktree.replace",
            "No existing issue worktree is attached.",
          );
        }
        const project = yield* projections.getProjectShellById(input.projectId).pipe(
          Effect.mapError((cause) =>
            operationError("worktree.replace", "Unable to resolve project.", cause),
          ),
          Effect.map(Option.getOrUndefined),
        );
        if (project === undefined)
          return yield* operationError("worktree.replace", "Project was not found.");
        if (
          !isSafeIssueWorktreePath({
            projectRoot: path.resolve(project.workspaceRoot),
            attachedPath: path.resolve(expectedPath),
            requestedPath: path.resolve(oldPath),
          })
        ) {
          return yield* operationError(
            "worktree.replace",
            "The replacement path is not the attached issue worktree.",
          );
        }
      }
      const detachedWorkspace =
        targetThreadId === undefined
          ? null
          : yield* findDetached(targetThreadId).pipe(
              Effect.map((row) =>
                row === null
                  ? null
                  : {
                      threadId: ThreadId.make(row.threadId),
                      projectId: ProjectId.make(row.projectId),
                      branch: row.branch,
                      worktreePath: row.worktreePath,
                      detachedAt: row.detachedAt,
                    },
              ),
            );
      const worktree = yield* issueWorktree(repo, input);
      if (targetThreadId !== undefined) {
        yield* dispatchWorkspace(targetThreadId, worktree.branch, worktree.worktreePath, "replace");
        yield* persistLink(
          { ...input, threadId: targetThreadId },
          repo,
          targetThreadId,
          worktree.branch,
          worktree.worktreePath,
          "agent",
        );
        yield* clearDetached(targetThreadId);
      }
      return { worktree, detachedWorkspace };
    });

  const authStatus = (input: IssueAuthStatusInput): Effect.Effect<IssueAuthStatus, IssueError> =>
    Effect.gen(function* () {
      const host = normalizeHost(input.host);
      const flow = flows.get(host);
      const output = yield* Effect.option(
        gh.execute({
          cwd: config.baseDir,
          args: ["auth", "status", "--hostname", host, "--json", "hosts"],
        }),
      );
      if (Option.isNone(output)) {
        return {
          provider: "github",
          host,
          status: "unauthenticated",
          account: null,
          flowId: flow?.id ?? null,
          authorizationUrl: flow === undefined ? null : `https://${host}/login/device`,
          userCode: flow?.userCode ?? null,
          expiresAt: flow?.expiresAt ?? null,
          detail: "GitHub CLI is not authenticated on this host.",
        };
      }
      const parsed = parseGitHubAuthStatus(output.value.stdout);
      const account = findAuthenticatedGitHubAccount(
        parsed.accounts.filter((entry) => entry.host === host),
      );
      return {
        provider: "github",
        host,
        status:
          account !== undefined ? "authenticated" : parsed.parsed ? "unauthenticated" : "unknown",
        account: account?.account ?? null,
        flowId: flow?.id ?? null,
        authorizationUrl: flow === undefined ? null : `https://${host}/login/device`,
        userCode: flow?.userCode ?? null,
        expiresAt: flow?.expiresAt ?? null,
        detail:
          account === undefined && !parsed.parsed
            ? "GitHub CLI returned an unrecognized auth response."
            : null,
      };
    });

  const authStart = (input: IssueAuthStartInput): Effect.Effect<IssueAuthStatus, IssueError> =>
    Effect.gen(function* () {
      const host = normalizeHost(input.host);
      if (!validHost(host)) return yield* operationError("auth.start", "GitHub host is invalid.");
      const existing = flows.get(host);
      if (existing !== undefined) return yield* authStatus({ host });
      const id = `github-auth-${host.replace(/[^a-z0-9]+/g, "-")}-${++flowSequence}`;
      const currentTime = yield* Clock.currentTimeMillis;
      const expiresAt = DateTime.formatIso(DateTime.makeUnsafe(currentTime + 10 * 60_000));
      const processScope = yield* Scope.make("sequential");
      const child = yield* spawner
        .spawn(
          ChildProcess.make(
            "gh",
            ["auth", "login", "--hostname", host, "--web", "--git-protocol", "https"],
            {
              cwd: config.baseDir,
              env: { ...process.env, BROWSER: "echo" },
              stdin: "ignore",
              stdout: "pipe",
              stderr: "pipe",
            },
          ),
        )
        .pipe(
          Effect.provideService(Scope.Scope, processScope),
          Effect.mapError((cause) =>
            operationError("auth.start", "Unable to start GitHub authentication.", cause),
          ),
        );
      const findCode = (text: string): Option.Option<string> => {
        const code = text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/u)?.[0];
        return code === undefined ? Option.none() : Option.some(code);
      };
      const code = yield* Stream.merge(child.stdout, child.stderr).pipe(
        Stream.decodeText(),
        Stream.map(findCode),
        Stream.filter(Option.isSome),
        Stream.map((value) => value.value),
        Stream.runHead,
        Effect.raceFirst(Effect.sleep("15 seconds").pipe(Effect.as(Option.none<string>()))),
        Effect.mapError((cause) =>
          operationError("auth.start", "Unable to read GitHub authorization output.", cause),
        ),
      );
      if (Option.isNone(code)) {
        yield* Scope.close(processScope, Exit.void).pipe(Effect.ignore);
        return yield* operationError(
          "auth.start",
          "GitHub CLI did not provide a device authorization code.",
        );
      }
      flows.set(host, {
        id,
        host,
        expiresAt,
        userCode: code.value,
        cancel: Scope.close(processScope, Exit.void).pipe(Effect.ignore),
      });
      yield* child.exitCode.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (flows.get(host)?.id === id) flows.delete(host);
          }),
        ),
        Effect.forkDetach,
      );
      return {
        provider: "github",
        host,
        status: "unknown",
        account: null,
        flowId: id,
        authorizationUrl: `https://${host}/login/device`,
        userCode: code.value,
        expiresAt,
        detail: "Complete GitHub authentication in the browser, then retry status.",
      };
    });

  const authCancel = (input: IssueAuthCancelInput): Effect.Effect<IssueAuthStatus, IssueError> =>
    Effect.gen(function* () {
      const host = normalizeHost(input.host);
      const flow = flows.get(host);
      if (flow === undefined || flow.id !== input.flowId) {
        return yield* operationError(
          "auth.cancel",
          "Authentication flow was not found or has expired.",
        );
      }
      yield* flow.cancel;
      flows.delete(host);
      return yield* authStatus({ host });
    });

  return {
    list,
    detail,
    comments,
    candidates,
    templates,
    create,
    update,
    commentCreate,
    commentUpdate,
    commentDelete,
    reactionUpdate,
    close,
    reopen,
    invalidate: (_input) =>
      Effect.sync(() => {
        listCache.clear();
        detailCache.clear();
        commentsCache.clear();
        templatesCache.clear();
      }),
    link,
    worktreePrepare,
    worktreeDeletePreflight,
    worktreeDelete,
    worktreeReplace,
    authStatus,
    authStart,
    authCancel,
  } satisfies IssueService["Service"];
});

export const layer = Layer.effect(IssueService, make);
