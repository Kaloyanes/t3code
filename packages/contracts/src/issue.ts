import * as Schema from "effect/Schema";
import * as HttpServerRespondable from "effect/http/HttpServerRespondable";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

const IssueTitle = TrimmedNonEmptyString.check(Schema.isMaxLength(256));
const IssueBody = Schema.String.check(Schema.isMaxLength(65_536));
const IssueQuery = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
const IssueCursor = TrimmedNonEmptyString.check(Schema.isMaxLength(4_096));
const IssueName = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
const IssueRepositoryName = TrimmedNonEmptyString.check(Schema.isMaxLength(256));

/** The source-control provider used by the issue surface. */
export const IssueProvider = Schema.Literal("github");
export type IssueProvider = typeof IssueProvider.Type;

export const IssueState = Schema.Literals(["open", "closed"]);
export type IssueState = typeof IssueState.Type;

export const IssueStateReason = Schema.NullOr(
  Schema.Literals(["completed", "not-planned", "duplicate"]),
);
export type IssueStateReason = typeof IssueStateReason.Type;

export const IssueListSort = Schema.Literals([
  "updated",
  "created-desc",
  "created-asc",
  "comments",
]);
export type IssueListSort = typeof IssueListSort.Type;

export const IssueListState = Schema.Literals(["all", "open", "closed"]);
export type IssueListState = typeof IssueListState.Type;

export const IssueInvolvement = Schema.Literals(["all", "authored", "assigned", "mentioned"]);
export type IssueInvolvement = typeof IssueInvolvement.Type;

/** The host-level identity shared by reads, links, and worktree operations. */
export const IssueIdentity = Schema.Struct({
  provider: IssueProvider,
  host: TrimmedNonEmptyString,
  repository: IssueRepositoryName,
  number: PositiveInt,
});
export type IssueIdentity = typeof IssueIdentity.Type;

/** Addresses an issue through a project checkout and an optional host override. */
export const IssueRef = Schema.Struct({
  projectId: ProjectId,
  host: Schema.optional(TrimmedNonEmptyString),
  repository: IssueRepositoryName,
  number: PositiveInt,
});
export type IssueRef = typeof IssueRef.Type;

/** Selects the checkout used for a repository read or mutation. */
export const IssueRepositorySelection = Schema.Struct({
  projectId: ProjectId,
  host: Schema.optional(TrimmedNonEmptyString),
  repository: IssueRepositoryName,
});
export type IssueRepositorySelection = typeof IssueRepositorySelection.Type;

export const IssueRepository = Schema.Struct({
  provider: IssueProvider,
  host: TrimmedNonEmptyString,
  projectId: ProjectId,
  projectTitle: TrimmedNonEmptyString,
  repository: IssueRepositoryName,
  url: TrimmedNonEmptyString,
});
export type IssueRepository = typeof IssueRepository.Type;

export const IssueActor = Schema.Struct({
  login: TrimmedNonEmptyString,
  name: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
});
export type IssueActor = typeof IssueActor.Type;

export const IssueLabel = Schema.Struct({
  name: TrimmedNonEmptyString,
  color: Schema.NullOr(Schema.String),
  description: Schema.optional(Schema.String),
});
export type IssueLabel = typeof IssueLabel.Type;

export const IssueMilestone = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  state: Schema.Literals(["open", "closed"]),
  description: Schema.optional(Schema.String),
  dueOn: Schema.NullOr(IsoDateTime),
});
export type IssueMilestone = typeof IssueMilestone.Type;

export const IssueAssignee = IssueActor;
export type IssueAssignee = typeof IssueAssignee.Type;

const IssueFilterValue = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
const IssueFilterValues = Schema.Array(IssueFilterValue).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(25),
);

export const IssueListFilters = Schema.Struct({
  labels: Schema.optional(Schema.Array(IssueFilterValues).check(Schema.isMaxLength(10))),
  excludedLabels: Schema.optional(IssueFilterValues),
  author: Schema.optional(IssueFilterValue),
  assignee: Schema.optional(IssueFilterValue),
  milestone: Schema.optional(IssueFilterValue),
});
export type IssueListFilters = typeof IssueListFilters.Type;

/** Opaque host cursors keyed by the selected repository. */
export const IssueListCursors = Schema.Record(TrimmedNonEmptyString, IssueCursor);
export type IssueListCursors = typeof IssueListCursors.Type;

/** Compact rows for the issue list; full body and conversation data arrive via detail/comments. */
export const IssueListEntry = Schema.Struct({
  provider: IssueProvider,
  host: TrimmedNonEmptyString,
  projectId: ProjectId,
  repository: IssueRepositoryName,
  number: PositiveInt,
  title: IssueTitle,
  url: TrimmedNonEmptyString,
  author: Schema.NullOr(IssueActor),
  state: IssueState,
  // Optional so newer clients can still list issues from servers that predate these fields.
  stateReason: Schema.optional(IssueStateReason),
  assignees: Schema.optional(Schema.Array(IssueActor)),
  milestone: Schema.optional(Schema.NullOr(IssueMilestone)),
  linkedWork: Schema.optional(Schema.NullOr(Schema.suspend(() => IssueLinkedWorkSummary))),
  labels: Schema.Array(IssueLabel),
  commentsCount: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  closedAt: Schema.NullOr(IsoDateTime),
});
export type IssueListEntry = typeof IssueListEntry.Type;

export const IssueProviderSummary = Schema.Struct({
  provider: IssueProvider,
  host: TrimmedNonEmptyString,
  searchesOnHost: Schema.Boolean,
  projectCount: PositiveInt,
  configured: Schema.Boolean,
  detail: Schema.NullOr(TrimmedNonEmptyString),
});
export type IssueProviderSummary = typeof IssueProviderSummary.Type;

export const IssueListRepositoryError = Schema.Struct({
  projectId: ProjectId,
  repository: IssueRepositoryName,
  message: TrimmedNonEmptyString,
});
export type IssueListRepositoryError = typeof IssueListRepositoryError.Type;

export const IssueListInput = Schema.Struct({
  state: IssueListState,
  sort: Schema.optional(IssueListSort),
  involvement: Schema.optional(IssueInvolvement),
  filters: Schema.optional(IssueListFilters),
  repository: Schema.optional(IssueRepositorySelection),
  repositories: Schema.optional(
    Schema.Array(IssueRepositorySelection).check(Schema.isMaxLength(100)),
  ),
  projectId: Schema.optional(ProjectId),
  projectIds: Schema.optional(Schema.Array(ProjectId).check(Schema.isMaxLength(100))),
  host: Schema.optional(TrimmedNonEmptyString),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }))),
  cursors: Schema.optional(IssueListCursors),
  query: Schema.optional(IssueQuery),
});
export type IssueListInput = typeof IssueListInput.Type;

export const IssueListResult = Schema.Struct({
  providers: Schema.Array(IssueProviderSummary),
  entries: Schema.Array(IssueListEntry),
  errors: Schema.Array(IssueListRepositoryError),
  truncated: Schema.Boolean,
  nextCursors: IssueListCursors,
});
export type IssueListResult = typeof IssueListResult.Type;

export const IssueViewerPermissions = Schema.Struct({
  comment: Schema.Boolean,
  update: Schema.Boolean,
  close: Schema.Boolean,
  reopen: Schema.Boolean,
  react: Schema.Boolean,
  link: Schema.Boolean,
});
export type IssueViewerPermissions = typeof IssueViewerPermissions.Type;

export const IssueRelatedIssue = Schema.Struct({
  number: PositiveInt,
  title: IssueTitle,
  url: TrimmedNonEmptyString,
  state: IssueState,
  repository: IssueRepositoryName,
});
export type IssueRelatedIssue = typeof IssueRelatedIssue.Type;

export const IssueLinkedPullRequest = Schema.Struct({
  ...IssueRelatedIssue.fields,
  state: Schema.Literals(["open", "closed", "merged"]),
  isDraft: Schema.optional(Schema.Boolean),
});
export type IssueLinkedPullRequest = typeof IssueLinkedPullRequest.Type;

export const IssueSubIssuesSummary = Schema.Struct({
  total: NonNegativeInt,
  completed: NonNegativeInt,
  percentCompleted: Schema.Number,
});
export type IssueSubIssuesSummary = typeof IssueSubIssuesSummary.Type;

export const IssueDetail = Schema.Struct({
  provider: IssueProvider,
  host: TrimmedNonEmptyString,
  projectId: ProjectId,
  projectTitle: TrimmedNonEmptyString,
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  repository: IssueRepositoryName,
  number: PositiveInt,
  title: IssueTitle,
  body: Schema.String,
  url: TrimmedNonEmptyString,
  author: Schema.NullOr(IssueActor),
  state: IssueState,
  stateReason: IssueStateReason,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  closedAt: Schema.NullOr(IsoDateTime),
  labels: Schema.Array(IssueLabel),
  assignees: Schema.Array(IssueAssignee),
  milestone: Schema.NullOr(IssueMilestone),
  commentsCount: NonNegativeInt,
  linkedPullRequests: Schema.optional(Schema.Array(IssueLinkedPullRequest)),
  parent: Schema.optional(Schema.NullOr(IssueRelatedIssue)),
  subIssues: Schema.optional(Schema.Array(IssueRelatedIssue)),
  subIssuesSummary: Schema.optional(IssueSubIssuesSummary),
  reactions: Schema.optional(Schema.Array(Schema.suspend(() => IssueReaction))),
  viewer: Schema.optional(TrimmedNonEmptyString),
  viewerPermissions: Schema.optional(IssueViewerPermissions),
  linkedWork: Schema.optional(Schema.NullOr(Schema.suspend(() => IssueLinkedWork))),
});
export type IssueDetail = typeof IssueDetail.Type;

export const IssueReactionContent = Schema.Literals([
  "thumbs-up",
  "thumbs-down",
  "laugh",
  "hooray",
  "confused",
  "heart",
  "rocket",
  "eyes",
]);
export type IssueReactionContent = typeof IssueReactionContent.Type;

export const IssueReaction = Schema.Struct({
  content: IssueReactionContent,
  count: PositiveInt,
  actors: Schema.Array(TrimmedNonEmptyString),
  viewerHasReacted: Schema.Boolean,
});
export type IssueReaction = typeof IssueReaction.Type;

export const IssueComment = Schema.Struct({
  id: TrimmedNonEmptyString,
  author: Schema.NullOr(IssueActor),
  body: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: Schema.optional(IsoDateTime),
  url: Schema.NullOr(Schema.String),
  reactions: Schema.optional(Schema.Array(IssueReaction)),
});
export type IssueComment = typeof IssueComment.Type;

export const IssueCommentsInput = Schema.Struct({
  ...IssueRef.fields,
  cursor: Schema.optional(IssueCursor),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
});
export type IssueCommentsInput = typeof IssueCommentsInput.Type;

export const IssueCommentsResult = Schema.Struct({
  comments: Schema.Array(IssueComment),
  nextCursor: Schema.NullOr(IssueCursor),
  commentCount: NonNegativeInt,
  truncated: Schema.Boolean,
});
export type IssueCommentsResult = typeof IssueCommentsResult.Type;

export const IssueTimelineSource = Schema.Struct({
  ...IssueRelatedIssue.fields,
  kind: Schema.Literals(["issue", "pull-request"]),
  state: Schema.Literals(["open", "closed", "merged"]),
});
export type IssueTimelineSource = typeof IssueTimelineSource.Type;

const IssueTimelineBase = {
  id: TrimmedNonEmptyString,
  actor: Schema.NullOr(IssueActor),
  createdAt: IsoDateTime,
};

export const IssueTimelineEvent = Schema.Union([
  Schema.TaggedStruct("labeled", { ...IssueTimelineBase, label: IssueLabel }),
  Schema.TaggedStruct("unlabeled", { ...IssueTimelineBase, label: IssueLabel }),
  Schema.TaggedStruct("assigned", { ...IssueTimelineBase, assignee: Schema.NullOr(IssueActor) }),
  Schema.TaggedStruct("unassigned", { ...IssueTimelineBase, assignee: Schema.NullOr(IssueActor) }),
  Schema.TaggedStruct("closed", { ...IssueTimelineBase, stateReason: IssueStateReason }),
  Schema.TaggedStruct("reopened", IssueTimelineBase),
  Schema.TaggedStruct("renamed", { ...IssueTimelineBase, from: Schema.String, to: Schema.String }),
  Schema.TaggedStruct("referenced", { ...IssueTimelineBase, source: IssueTimelineSource }),
  Schema.TaggedStruct("cross-referenced", { ...IssueTimelineBase, source: IssueTimelineSource }),
  Schema.TaggedStruct("milestoned", { ...IssueTimelineBase, title: Schema.String }),
  Schema.TaggedStruct("demilestoned", { ...IssueTimelineBase, title: Schema.String }),
  Schema.TaggedStruct("connected", { ...IssueTimelineBase, pullRequest: IssueLinkedPullRequest }),
  Schema.TaggedStruct("comment", { ...IssueTimelineBase, comment: IssueComment }),
]);
export type IssueTimelineEvent = typeof IssueTimelineEvent.Type;

export const IssueTimelineInput = IssueCommentsInput;
export type IssueTimelineInput = typeof IssueTimelineInput.Type;

export const IssueTimelineResult = Schema.Struct({
  events: Schema.Array(IssueTimelineEvent),
  nextCursor: Schema.NullOr(IssueCursor),
  totalCount: NonNegativeInt,
  truncated: Schema.Boolean,
});
export type IssueTimelineResult = typeof IssueTimelineResult.Type;

export const IssueCandidateKind = Schema.Literals(["labels", "assignees"]);
export type IssueCandidateKind = typeof IssueCandidateKind.Type;

export const IssueLabelCandidate = Schema.Struct({
  name: TrimmedNonEmptyString,
  color: Schema.NullOr(Schema.String),
  description: Schema.optional(Schema.String),
});
export type IssueLabelCandidate = typeof IssueLabelCandidate.Type;

export const IssueAssigneeCandidate = Schema.Struct({
  login: TrimmedNonEmptyString,
  name: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
});
export type IssueAssigneeCandidate = typeof IssueAssigneeCandidate.Type;

export const IssueCandidatesInput = Schema.Struct({
  ...IssueRepositorySelection.fields,
  kind: IssueCandidateKind,
  query: Schema.optional(IssueQuery),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
});
export type IssueCandidatesInput = typeof IssueCandidatesInput.Type;

export const IssueCandidatesResult = Schema.Union([
  Schema.TaggedStruct("labels", {
    candidates: Schema.Array(IssueLabelCandidate),
  }),
  Schema.TaggedStruct("assignees", {
    candidates: Schema.Array(IssueAssigneeCandidate),
  }),
]);
export type IssueCandidatesResult = typeof IssueCandidatesResult.Type;

export const IssueTemplateKind = Schema.Literals(["blank", "markdown", "issue-form"]);
export type IssueTemplateKind = typeof IssueTemplateKind.Type;

export const IssueTemplate = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  kind: IssueTemplateKind,
  title: Schema.optional(Schema.String),
  body: Schema.optional(Schema.String),
  labels: Schema.Array(TrimmedNonEmptyString),
  assignees: Schema.Array(TrimmedNonEmptyString),
});
export type IssueTemplate = typeof IssueTemplate.Type;

export const IssueTemplatesInput = Schema.Struct({
  ...IssueRepositorySelection.fields,
});
export type IssueTemplatesInput = typeof IssueTemplatesInput.Type;

export const IssueTemplatesResult = Schema.Struct({
  templates: Schema.Array(IssueTemplate),
});
export type IssueTemplatesResult = typeof IssueTemplatesResult.Type;

export const IssueCreateInput = Schema.Struct({
  ...IssueRepositorySelection.fields,
  title: IssueTitle,
  body: IssueBody,
  templateId: Schema.optional(TrimmedNonEmptyString),
  labels: Schema.optional(Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(25))),
  assignees: Schema.optional(Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(25))),
  milestone: Schema.optional(TrimmedNonEmptyString),
});
export type IssueCreateInput = typeof IssueCreateInput.Type;

export const IssueCreateResult = Schema.Struct({
  issue: IssueDetail,
});
export type IssueCreateResult = typeof IssueCreateResult.Type;

export const IssueUpdateInput = Schema.Struct({
  ...IssueRef.fields,
  title: Schema.optional(IssueTitle),
  body: Schema.optional(IssueBody),
  labels: Schema.optional(Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(25))),
  assignees: Schema.optional(Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(25))),
  milestone: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  /** Additive edits, applied without replacing what others set since the issue was read. */
  addLabels: Schema.optional(Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(25))),
  removeLabels: Schema.optional(Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(25))),
  addAssignees: Schema.optional(Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(25))),
  removeAssignees: Schema.optional(
    Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(25)),
  ),
});
export type IssueUpdateInput = typeof IssueUpdateInput.Type;

export const IssueUpdateResult = Schema.Struct({
  issue: IssueDetail,
});
export type IssueUpdateResult = typeof IssueUpdateResult.Type;

export const IssueCloseReason = Schema.Literals(["completed", "not-planned", "duplicate"]);
export type IssueCloseReason = typeof IssueCloseReason.Type;

export const IssueCloseInput = Schema.Struct({
  ...IssueRef.fields,
  reason: Schema.optional(IssueCloseReason),
});
export type IssueCloseInput = typeof IssueCloseInput.Type;

export const IssueCloseResult = Schema.Struct({
  issue: IssueDetail,
});
export type IssueCloseResult = typeof IssueCloseResult.Type;

export const IssueReopenInput = Schema.Struct({
  ...IssueRef.fields,
});
export type IssueReopenInput = typeof IssueReopenInput.Type;

export const IssueReopenResult = Schema.Struct({
  issue: IssueDetail,
});
export type IssueReopenResult = typeof IssueReopenResult.Type;

export const IssueCommentCreateInput = Schema.Struct({
  ...IssueRef.fields,
  body: IssueBody,
});
export type IssueCommentCreateInput = typeof IssueCommentCreateInput.Type;

export const IssueCommentCreateResult = Schema.Struct({
  comment: IssueComment,
});
export type IssueCommentCreateResult = typeof IssueCommentCreateResult.Type;

export const IssueCommentUpdateInput = Schema.Struct({
  ...IssueRef.fields,
  commentId: TrimmedNonEmptyString,
  body: IssueBody,
});
export type IssueCommentUpdateInput = typeof IssueCommentUpdateInput.Type;

export const IssueCommentUpdateResult = Schema.Struct({
  comment: IssueComment,
});
export type IssueCommentUpdateResult = typeof IssueCommentUpdateResult.Type;

export const IssueCommentDeleteInput = Schema.Struct({
  ...IssueRef.fields,
  commentId: TrimmedNonEmptyString,
});
export type IssueCommentDeleteInput = typeof IssueCommentDeleteInput.Type;

export const IssueReactionUpdateInput = Schema.Struct({
  ...IssueRef.fields,
  subjectId: Schema.optional(TrimmedNonEmptyString),
  content: IssueReactionContent,
  reacted: Schema.Boolean,
});
export type IssueReactionUpdateInput = typeof IssueReactionUpdateInput.Type;

export const IssueLinkSource = Schema.Literals(["manual", "created", "agent"]);
export type IssueLinkSource = typeof IssueLinkSource.Type;

export const IssueLinkedWorkSummary = Schema.Struct({
  threadId: ThreadId,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  source: IssueLinkSource,
});
export type IssueLinkedWorkSummary = typeof IssueLinkedWorkSummary.Type;

/** Work associated with an issue, usually a thread and its current checkout. */
export const IssueLinkedWork = Schema.Struct({
  issue: IssueIdentity,
  threadId: ThreadId,
  projectId: ProjectId,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  linkedAt: IsoDateTime,
  source: IssueLinkSource,
  /** Last state the server observed; absent until the issue is first read. */
  state: Schema.optional(IssueState),
});
export type IssueLinkedWork = typeof IssueLinkedWork.Type;

export const IssueLinkInput = Schema.Struct({
  ...IssueRef.fields,
  threadId: ThreadId,
  source: Schema.optional(IssueLinkSource),
});
export type IssueLinkInput = typeof IssueLinkInput.Type;

export const IssueLinkResult = Schema.Struct({
  linkedWork: IssueLinkedWork,
});
export type IssueLinkResult = typeof IssueLinkResult.Type;

/** The named checkout prepared for work on an issue. */
export const IssueWorktree = Schema.Struct({
  projectId: ProjectId,
  issue: IssueIdentity,
  name: IssueName,
  branch: TrimmedNonEmptyString,
  worktreePath: TrimmedNonEmptyString,
  baseBranch: TrimmedNonEmptyString,
});
export type IssueWorktree = typeof IssueWorktree.Type;

export const IssueWorktreePrepareInput = Schema.Struct({
  ...IssueRef.fields,
  name: IssueName,
  baseBranch: Schema.optional(TrimmedNonEmptyString),
  threadId: Schema.optional(ThreadId),
});
export type IssueWorktreePrepareInput = typeof IssueWorktreePrepareInput.Type;

export const IssueWorktreePrepareResult = Schema.Struct({
  worktree: IssueWorktree,
  linkedWork: Schema.NullOr(IssueLinkedWork),
});
export type IssueWorktreePrepareResult = typeof IssueWorktreePrepareResult.Type;

export const IssueDetachedWorkspace = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  detachedAt: IsoDateTime,
});
export type IssueDetachedWorkspace = typeof IssueDetachedWorkspace.Type;

export const IssueWorktreeDeleteSelection = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  path: TrimmedNonEmptyString,
});
export type IssueWorktreeDeleteSelection = typeof IssueWorktreeDeleteSelection.Type;

export const IssueWorktreeDeleteSelections = Schema.Array(IssueWorktreeDeleteSelection).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(100),
);
export type IssueWorktreeDeleteSelections = typeof IssueWorktreeDeleteSelections.Type;

export const IssueWorktreeDeletePreflightInput = Schema.Struct({
  selections: IssueWorktreeDeleteSelections,
});
export type IssueWorktreeDeletePreflightInput = typeof IssueWorktreeDeletePreflightInput.Type;

export const IssueWorktreeDeleteIssue = Schema.Struct({
  ...IssueRef.fields,
  state: Schema.NullOr(IssueState),
});
export type IssueWorktreeDeleteIssue = typeof IssueWorktreeDeleteIssue.Type;

export const IssueWorktreeDeleteDecision = Schema.Struct({
  ...IssueRef.fields,
  action: Schema.Literals(["keep-open", "completed", "not-planned"]),
});
export type IssueWorktreeDeleteDecision = typeof IssueWorktreeDeleteDecision.Type;

export const IssueWorktreeDeletePreflightItem = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  path: TrimmedNonEmptyString,
  branch: TrimmedNonEmptyString,
  issues: Schema.optional(Schema.Array(IssueWorktreeDeleteIssue)),
  activeAgent: Schema.NullOr(TrimmedNonEmptyString),
  blocked: Schema.Boolean,
  changedFiles: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(1_000)),
  unpushedCommitCount: NonNegativeInt,
  canDelete: Schema.Boolean,
  requiresForce: Schema.Boolean,
  reason: Schema.NullOr(TrimmedNonEmptyString),
});
export type IssueWorktreeDeletePreflightItem = typeof IssueWorktreeDeletePreflightItem.Type;

export const IssueWorktreeDeletePreflightResult = Schema.Struct({
  items: Schema.Array(IssueWorktreeDeletePreflightItem).check(Schema.isMaxLength(100)),
});
export type IssueWorktreeDeletePreflightResult = typeof IssueWorktreeDeletePreflightResult.Type;

export const IssueWorktreeDeleteInput = Schema.Struct({
  selections: IssueWorktreeDeleteSelections,
  forceAcknowledged: Schema.Boolean,
  preserveUnpushedCommits: Schema.optional(Schema.Boolean),
  issueDecisions: Schema.optional(Schema.Array(IssueWorktreeDeleteDecision)),
});
export type IssueWorktreeDeleteInput = typeof IssueWorktreeDeleteInput.Type;

export const IssueWorktreeDeleteItemResult = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  path: TrimmedNonEmptyString,
  deleted: Schema.Boolean,
  error: Schema.NullOr(TrimmedNonEmptyString),
  detachedWorkspace: Schema.NullOr(IssueDetachedWorkspace),
  warnings: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});
export type IssueWorktreeDeleteItemResult = typeof IssueWorktreeDeleteItemResult.Type;

export const IssueWorktreeDeleteResult = Schema.Struct({
  results: Schema.Array(IssueWorktreeDeleteItemResult).check(Schema.isMaxLength(100)),
});
export type IssueWorktreeDeleteResult = typeof IssueWorktreeDeleteResult.Type;

export const IssueWorktreeReplaceInput = Schema.Struct({
  ...IssueRef.fields,
  name: IssueName,
  baseBranch: Schema.optional(TrimmedNonEmptyString),
  threadId: Schema.optional(ThreadId),
  worktreePath: Schema.optional(TrimmedNonEmptyString),
});
export type IssueWorktreeReplaceInput = typeof IssueWorktreeReplaceInput.Type;

export const IssueWorktreeReplaceResult = Schema.Struct({
  worktree: IssueWorktree,
  detachedWorkspace: Schema.NullOr(IssueDetachedWorkspace),
});
export type IssueWorktreeReplaceResult = typeof IssueWorktreeReplaceResult.Type;

export const IssueAuthStatus = Schema.Struct({
  provider: IssueProvider,
  host: TrimmedNonEmptyString,
  status: Schema.Literals(["authenticated", "unauthenticated", "unknown"]),
  account: Schema.NullOr(TrimmedNonEmptyString),
  flowId: Schema.NullOr(TrimmedNonEmptyString),
  authorizationUrl: Schema.NullOr(Schema.String),
  userCode: Schema.NullOr(TrimmedNonEmptyString),
  expiresAt: Schema.NullOr(IsoDateTime),
  detail: Schema.NullOr(TrimmedNonEmptyString),
});
export type IssueAuthStatus = typeof IssueAuthStatus.Type;

export const IssueAuthStatusInput = Schema.Struct({
  provider: Schema.optional(IssueProvider),
  host: Schema.optional(TrimmedNonEmptyString),
});
export type IssueAuthStatusInput = typeof IssueAuthStatusInput.Type;

export const IssueAuthStartInput = Schema.Struct({
  provider: Schema.optional(IssueProvider),
  host: Schema.optional(TrimmedNonEmptyString),
});
export type IssueAuthStartInput = typeof IssueAuthStartInput.Type;

export const IssueAuthStartResult = IssueAuthStatus;
export type IssueAuthStartResult = typeof IssueAuthStartResult.Type;

export const IssueAuthCancelInput = Schema.Struct({
  provider: Schema.optional(IssueProvider),
  host: Schema.optional(TrimmedNonEmptyString),
  flowId: TrimmedNonEmptyString,
});
export type IssueAuthCancelInput = typeof IssueAuthCancelInput.Type;

export const IssueAuthCancelResult = IssueAuthStatus;
export type IssueAuthCancelResult = typeof IssueAuthCancelResult.Type;

export const IssueInvalidateInput = Schema.Struct({
  reference: Schema.optional(IssueRef),
  repository: Schema.optional(IssueRepositorySelection),
});
export type IssueInvalidateInput = typeof IssueInvalidateInput.Type;

export const IssueUnavailableReason = Schema.Literals([
  "cli-missing",
  "cli-unauthenticated",
  "provider-unsupported",
]);
export type IssueUnavailableReason = typeof IssueUnavailableReason.Type;

export class IssueUnavailableError extends Schema.TaggedError<IssueUnavailableError>()(
  "IssueUnavailableError",
  {
    reason: IssueUnavailableReason,
    provider: Schema.optional(IssueProvider),
    host: Schema.optional(TrimmedNonEmptyString),
    cause: Schema.optional(Schema.Defect()),
  },
  { httpApiStatus: 503 },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.schemaJson(IssueUnavailableError)(this, { status: 503 });
  }

  override get message(): string {
    switch (this.reason) {
      case "cli-missing":
        return "GitHub CLI (`gh`) is required to browse issues on this host.";
      case "cli-unauthenticated":
        return "GitHub CLI is not authenticated on this host.";
      case "provider-unsupported":
        return "Issues cannot be browsed for this project's host yet.";
    }
  }
}

export class IssueOperationError extends Schema.TaggedError<IssueOperationError>()(
  "IssueOperationError",
  {
    operation: Schema.String,
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
  { httpApiStatus: 502 },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.schemaJson(IssueOperationError)(this, { status: 502 });
  }

  override get message(): string {
    return `Issue operation ${this.operation} failed: ${this.detail}`;
  }
}

export const IssueRpcError = Schema.Union([IssueUnavailableError, IssueOperationError]);
export type IssueRpcError = typeof IssueRpcError.Type;
