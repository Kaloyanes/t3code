import {
  IssueCloseInput,
  IssueCloseResult,
  IssueCommentCreateInput,
  IssueCommentCreateResult,
  IssueCommentsResult,
  IssueDetail,
  IssueLinkResult,
  IssueListInput,
  IssueListResult,
  IssueRef,
  IssueReopenInput,
  IssueReopenResult,
  IssueUpdateInput,
  IssueUpdateResult,
  McpCapabilityUnavailableError,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import * as IssueService from "../../../issue/IssueService.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  Orchestrator.OrchestratorV2,
  IssueService.IssueService,
];

export class IssueThreadNotFoundError extends Schema.TaggedError<IssueThreadNotFoundError>()(
  "IssueThreadNotFoundError",
  { threadId: Schema.String },
) {
  override get message(): string {
    return `Thread ${this.threadId} was not found.`;
  }
}

export class IssueOutsideThreadProjectError extends Schema.TaggedError<IssueOutsideThreadProjectError>()(
  "IssueOutsideThreadProjectError",
  { projectId: Schema.String },
) {
  override get message(): string {
    return `Issues can only be changed in this thread's own project, not project ${this.projectId}.`;
  }
}

export class IssueListFailedError extends Schema.TaggedError<IssueListFailedError>()(
  "IssueListFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not list the issues.";
  }
}

export class IssueReadFailedError extends Schema.TaggedError<IssueReadFailedError>()(
  "IssueReadFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not read the issue.";
  }
}

export class IssueCommentFailedError extends Schema.TaggedError<IssueCommentFailedError>()(
  "IssueCommentFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not comment on the issue.";
  }
}

export class IssueCloseFailedError extends Schema.TaggedError<IssueCloseFailedError>()(
  "IssueCloseFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not close the issue.";
  }
}

export class IssueReopenFailedError extends Schema.TaggedError<IssueReopenFailedError>()(
  "IssueReopenFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not reopen the issue.";
  }
}

export class IssueUpdateFailedError extends Schema.TaggedError<IssueUpdateFailedError>()(
  "IssueUpdateFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not update the issue.";
  }
}

export class IssueLinkFailedError extends Schema.TaggedError<IssueLinkFailedError>()(
  "IssueLinkFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not link the issue.";
  }
}

const IssueToolError = Schema.Union([
  McpCapabilityUnavailableError,
  IssueThreadNotFoundError,
  IssueOutsideThreadProjectError,
  IssueListFailedError,
  IssueReadFailedError,
  IssueCommentFailedError,
  IssueCloseFailedError,
  IssueReopenFailedError,
  IssueUpdateFailedError,
  IssueLinkFailedError,
]);

const ListIssuesTool = Tool.make("list_issues", {
  description:
    "List GitHub issues across configured projects, with state, query, involvement, filters and pagination. Set projectId to limit the search to one project.",
  parameters: IssueListInput,
  success: IssueListResult,
  failure: IssueToolError,
  dependencies,
})
  .annotate(Tool.Title, "List issues")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const ReadIssueTool = Tool.make("read_issue", {
  description:
    "Read a GitHub issue's details and first page of comments. The comments result includes a cursor when more comments are available.",
  parameters: IssueRef,
  success: Schema.Struct({ issue: IssueDetail, comments: IssueCommentsResult }),
  failure: IssueToolError,
  dependencies,
})
  .annotate(Tool.Title, "Read issue")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const CommentOnIssueTool = Tool.make("comment_on_issue", {
  description:
    "Post a comment on a GitHub issue. Each call creates a new comment; do not retry a successful call.",
  parameters: IssueCommentCreateInput,
  success: IssueCommentCreateResult,
  failure: IssueToolError,
  dependencies,
})
  .annotate(Tool.Title, "Comment on issue")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const CloseIssueTool = Tool.make("close_issue", {
  description:
    "Close a GitHub issue, optionally with reason completed, not-planned or duplicate. Use reopen_issue to reopen it.",
  parameters: IssueCloseInput,
  success: IssueCloseResult,
  failure: IssueToolError,
  dependencies,
})
  .annotate(Tool.Title, "Close issue")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const ReopenIssueTool = Tool.make("reopen_issue", {
  description: "Reopen a closed GitHub issue.",
  parameters: IssueReopenInput,
  success: IssueReopenResult,
  failure: IssueToolError,
  dependencies,
})
  .annotate(Tool.Title, "Reopen issue")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const UpdateIssueTool = Tool.make("update_issue", {
  description:
    "Update a GitHub issue's title, body, labels, assignees or milestone. Omitted fields are preserved. Prefer addLabels, removeLabels, addAssignees and removeAssignees, which keep changes others made; labels and assignees replace the current lists.",
  parameters: IssueUpdateInput,
  success: IssueUpdateResult,
  failure: IssueToolError,
  dependencies,
})
  .annotate(Tool.Title, "Update issue")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const LinkIssueTool = Tool.make("link_issue", {
  description:
    "Link a GitHub issue to the current thread so T3 Code tracks the work. The thread comes from the calling credential; linking again is safe.",
  parameters: IssueRef,
  success: IssueLinkResult,
  failure: IssueToolError,
  dependencies,
})
  .annotate(Tool.Title, "Link issue to thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const IssuesToolkit = Toolkit.make(
  ListIssuesTool,
  ReadIssueTool,
  CommentOnIssueTool,
  CloseIssueTool,
  ReopenIssueTool,
  UpdateIssueTool,
  LinkIssueTool,
);
