import type {
  EnvironmentId,
  IssueActor,
  IssueComment,
  IssueCommentsResult,
  IssueDetail,
  IssueLinkedPullRequest,
  IssueRef,
  IssueRelatedIssue,
  ScopedThreadRef,
} from "@t3tools/contracts";
import {
  ArrowDownUpIcon,
  CornerLeftUpIcon,
  GitBranchIcon,
  MilestoneIcon,
  TagIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { useState, type MouseEvent as ReactMouseEvent } from "react";

import { useOpenPrLink } from "~/lib/openPullRequestLink";
import { readLocalApi } from "~/localApi";
import { issueEnvironment } from "~/state/issues";
import { useAtomCommand } from "~/state/use-atom-command";

import { Button, InlineButton } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MiddleTruncate } from "../ui/middle-truncate";
import { MetaRow, Section } from "../workItem/WorkItemSummaryParts";
import { PullRequestActivityUnavailableState } from "../pullRequest/PullRequestActivityUnavailableState";
import { PullRequestCommentBody } from "../pullRequest/PullRequestCommentBody";
import { orderPullRequestComments } from "../pullRequest/pullRequestDetail.logic";
import { PullRequestEditButton } from "../pullRequest/PullRequestEditButton";
import { PullRequestConversationGhost } from "../pullRequest/PullRequestGhosts";
import { PullRequestMarkdown } from "../pullRequest/PullRequestMarkdown";
import { PullRequestMarkdownEditor } from "../pullRequest/PullRequestMarkdownEditor";
import { ReactionBar } from "../pullRequest/PullRequestReactions";
import { CommentIdentity } from "../pullRequest/PullRequestSummaryTab";
import {
  PullRequestActorLabel,
  PullRequestLabelChip,
  PullRequestStateGlyph,
} from "../pullRequest/pullRequestPresentation";
import { formatActionError } from "./issueActions";
import { issueSubIssueProgress, toggleIssueName } from "./issueDetail.logic";
import { IssueAssigneePicker, IssueLabelPicker } from "./IssuePickers";
import { IssueStateGlyph } from "./IssueStateGlyph";

/** A GitHub profile, except for apps, whose logins do not name a profile page. */
export function issueActorProfileUrl(issue: Pick<IssueDetail, "url">, actor: IssueActor | null) {
  return actor && !actor.login.endsWith("[bot]")
    ? new URL(`/${encodeURIComponent(actor.login)}`, issue.url).toString()
    : null;
}

/** An issue or pull request named by its number and title, in its state's glyph. */
export function IssueReferenceButton({
  item,
  kind,
  onOpen,
}: {
  item: Pick<IssueRelatedIssue, "number" | "title"> &
    ({ state: IssueRelatedIssue["state"] } | Pick<IssueLinkedPullRequest, "state" | "isDraft">);
  kind: "issue" | "pull-request";
  onOpen: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-sm text-left text-xs text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      {kind === "pull-request" ? (
        <PullRequestStateGlyph
          state={item.state}
          isDraft={"isDraft" in item ? item.isDraft === true : false}
          className="size-3.5"
        />
      ) : (
        <IssueStateGlyph state={item.state === "open" ? "open" : "closed"} className="size-3.5" />
      )}
      <span className="shrink-0 text-muted-foreground">#{item.number}</span>
      <span className="min-w-0 truncate">{item.title}</span>
    </button>
  );
}

/** A local change shown before the host confirms it, dropped once the host's answer arrives. */
function useOptimisticNames(current: ReadonlyArray<string>) {
  const signature = current.join("\n");
  const [draft, setDraft] = useState<{
    readonly signature: string;
    readonly names: ReadonlyArray<string>;
  } | null>(null);
  const shown = draft?.signature === signature ? draft.names : current;
  return {
    shown,
    set: (names: ReadonlyArray<string>) => setDraft({ signature, names }),
    reset: () => setDraft(null),
  };
}

export function IssueSummaryTab({
  environmentId,
  threadRef,
  reference,
  issue,
  cwd,
  comments,
  editingBody,
  onEditingBodyChange,
  onRefresh,
  onOpenRelatedIssue,
  onOpenLinkedWork,
}: {
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef | null;
  reference: IssueRef;
  issue: IssueDetail;
  cwd: string;
  comments: {
    readonly data: IssueCommentsResult | null;
    readonly error: string | null;
    readonly isPending: boolean;
    readonly refresh: () => void;
  };
  editingBody: boolean;
  onEditingBodyChange: (editing: boolean) => void;
  /** The issue changed on the host; read it again, and anything showing it. */
  onRefresh: () => void;
  onOpenRelatedIssue: (issue: IssueRelatedIssue) => void;
  onOpenLinkedWork: () => void;
}) {
  const update = useAtomCommand(issueEnvironment.update, { reportFailure: false });
  const reactionUpdate = useAtomCommand(issueEnvironment.reactionUpdate, { reportFailure: false });
  const openPrLink = useOpenPrLink(threadRef ?? undefined);
  const selection = {
    projectId: reference.projectId,
    ...(reference.host === undefined ? {} : { host: reference.host }),
    repository: reference.repository,
  };
  const permissions = issue.viewerPermissions;
  const canUpdate = permissions?.update !== false;
  const canReact = permissions?.react !== false;
  const labels = useOptimisticNames(issue.labels.map((label) => label.name));
  const assignees = useOptimisticNames(issue.assignees.map((assignee) => assignee.login));
  const [saving, setSaving] = useState<"labels" | "assignees" | "body" | null>(null);
  const [commentOrder, setCommentOrder] = useState<"newest" | "oldest">("newest");

  const saveNames = async (
    field: "labels" | "assignees",
    names: ReadonlyArray<string>,
    failure: string,
  ) => {
    const optimistic = field === "labels" ? labels : assignees;
    optimistic.set(names);
    setSaving(field);
    const result = await update({
      environmentId,
      input: { ...reference, ...(field === "labels" ? { labels: names } : { assignees: names }) },
    });
    setSaving(null);
    if (result._tag === "Failure") {
      optimistic.reset();
      toastManager.add({
        type: "error",
        title: failure,
        description: formatActionError("The host refused the change", result.cause),
      });
      return;
    }
    onRefresh();
  };

  const saveBody = async (body: string) => {
    if (saving !== null) return;
    setSaving("body");
    const result = await update({ environmentId, input: { ...reference, body } });
    setSaving(null);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: "Could not save the description" });
      return;
    }
    onEditingBodyChange(false);
    onRefresh();
  };

  const labelColors = new Map(issue.labels.map((label) => [label.name, label.color] as const));
  const assigneeActors = new Map(
    issue.assignees.map((actor) => [actor.login.toLowerCase(), actor] as const),
  );
  const linkedPullRequests = issue.linkedPullRequests ?? [];
  const subIssues = issue.subIssues ?? [];
  const progress = issueSubIssueProgress(issue.subIssuesSummary, subIssues);
  const commentsResult = comments.data;
  const orderedComments = orderPullRequestComments(commentsResult?.comments ?? [], commentOrder);

  return (
    <div className="h-full overflow-y-auto" data-pull-request-summary-scroll>
      <section className="px-4 pt-2.5 pb-1">
        <div className="space-y-2">
          <MetaRow icon={<UsersIcon className="size-3.5" />} label="Assignees">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              {assignees.shown.length === 0 ? (
                <span className="text-muted-foreground">None</span>
              ) : (
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  {assignees.shown.map((login) => {
                    const actor = assigneeActors.get(login.toLowerCase()) ?? {
                      login,
                      name: null,
                      avatarUrl: null,
                    };
                    return (
                      <PullRequestActorLabel
                        key={login}
                        actor={actor}
                        profileUrl={issueActorProfileUrl(issue, actor)}
                      />
                    );
                  })}
                </span>
              )}
              <IssueAssigneePicker
                environmentId={environmentId}
                selection={selection}
                selected={assignees.shown}
                allowed={canUpdate}
                disabled={saving === "assignees"}
                onToggle={(login, applied) =>
                  void saveNames(
                    "assignees",
                    toggleIssueName(assignees.shown, login, applied),
                    applied ? `Could not assign ${login}` : `Could not unassign ${login}`,
                  )
                }
              />
            </span>
          </MetaRow>
          <MetaRow icon={<TagIcon className="size-3.5" />} label="Labels">
            <span className="flex min-w-0 flex-wrap items-center gap-1">
              {labels.shown.length === 0 ? (
                <span className="text-muted-foreground">None</span>
              ) : (
                labels.shown.map((name) => (
                  <PullRequestLabelChip
                    key={name}
                    label={{ name, color: labelColors.get(name) ?? null }}
                    size="default"
                    className="max-w-48"
                  />
                ))
              )}
              <IssueLabelPicker
                environmentId={environmentId}
                selection={selection}
                selected={labels.shown}
                allowed={canUpdate}
                disabled={saving === "labels"}
                onToggle={(name, applied) =>
                  void saveNames(
                    "labels",
                    toggleIssueName(labels.shown, name, applied),
                    applied ? `Could not put ${name} on` : `Could not take ${name} off`,
                  )
                }
              />
            </span>
          </MetaRow>
          {issue.milestone ? (
            <MetaRow icon={<MilestoneIcon className="size-3.5" />} label="Milestone">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate">{issue.milestone.title}</span>
                {issue.milestone.dueOn ? (
                  <span className="shrink-0 text-muted-foreground">
                    due {new Date(issue.milestone.dueOn).toLocaleDateString()}
                  </span>
                ) : null}
                {issue.milestone.state === "closed" ? (
                  <span className="shrink-0 text-muted-foreground">· closed</span>
                ) : null}
              </span>
            </MetaRow>
          ) : null}
          {issue.linkedWork ? (
            <MetaRow icon={<GitBranchIcon className="size-3.5" />} label="Linked work">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <InlineButton className="flex max-w-full min-w-0" onClick={onOpenLinkedWork} />
                  }
                >
                  <code className="flex min-w-0">
                    <MiddleTruncate
                      value={
                        issue.linkedWork.branch ?? issue.linkedWork.worktreePath ?? "Linked thread"
                      }
                      showTitle={false}
                    />
                  </code>
                </TooltipTrigger>
                <TooltipPopup side="bottom">Open the linked thread</TooltipPopup>
              </Tooltip>
            </MetaRow>
          ) : null}
          {linkedPullRequests.length > 0 ? (
            <MetaRow
              icon={<PullRequestStateGlyph state="open" isDraft={false} className="size-3.5" />}
              label="Pull requests"
            >
              <span className="flex min-w-0 flex-col gap-1 py-1">
                {linkedPullRequests.map((pullRequest) => (
                  <IssueReferenceButton
                    key={pullRequest.url}
                    item={pullRequest}
                    kind="pull-request"
                    onOpen={(event) => openPrLink(event, pullRequest.url)}
                  />
                ))}
              </span>
            </MetaRow>
          ) : null}
          {issue.parent ? (
            <MetaRow icon={<CornerLeftUpIcon className="size-3.5" />} label="Parent">
              <IssueReferenceButton
                item={issue.parent}
                kind="issue"
                onOpen={() => issue.parent && onOpenRelatedIssue(issue.parent)}
              />
            </MetaRow>
          ) : null}
        </div>
      </section>

      {progress !== null || subIssues.length > 0 ? (
        <Section key={`sub-issues:${issue.url}`} title="Sub-issues">
          {progress ? (
            <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
              <div
                role="progressbar"
                aria-label="Sub-issues done"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.completed}
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-success"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <span className="shrink-0 tabular-nums">{progress.label}</span>
            </div>
          ) : null}
          <ul className="space-y-1">
            {subIssues.map((subIssue) => (
              <li key={subIssue.url} className="flex min-w-0 py-0.5">
                <IssueReferenceButton
                  item={subIssue}
                  kind="issue"
                  onOpen={() => onOpenRelatedIssue(subIssue)}
                />
              </li>
            ))}
          </ul>
          {progress && progress.total > subIssues.length ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {progress.total - subIssues.length} more on GitHub.
            </p>
          ) : null}
        </Section>
      ) : null}

      <Section key={`description:${issue.url}`} title="Description" keepMounted>
        <div className="group">
          {editingBody ? (
            <PullRequestMarkdownEditor
              // Empty is a real answer here: saving nothing is how a description is cleared.
              allowEmpty
              value={issue.body}
              cwd={cwd}
              environmentId={environmentId}
              threadRef={threadRef}
              label="Issue description"
              placeholder="Describe this issue"
              saving={saving === "body"}
              onSave={(body) => void saveBody(body)}
              onCancel={() => onEditingBodyChange(false)}
            />
          ) : (
            <div className="flex items-start gap-1">
              <PullRequestMarkdown
                className="min-w-0 flex-1"
                text={issue.body.trim().length > 0 ? issue.body : "_No description provided._"}
                cwd={cwd}
                environmentId={environmentId}
                threadRef={threadRef}
              />
              {canUpdate ? (
                <PullRequestEditButton
                  aria-label="Edit description"
                  onClick={() => onEditingBodyChange(true)}
                />
              ) : null}
            </div>
          )}
          <ReactionBar
            className="mt-3"
            reactions={issue.reactions ?? []}
            canReact={canReact}
            onSetReaction={async (content, reacted) => {
              const result = await reactionUpdate({
                environmentId,
                input: { ...reference, content, reacted },
              });
              if (result._tag === "Failure") return false;
              onRefresh();
              return true;
            }}
          />
        </div>
      </Section>

      <Section
        title={`Comments (${issue.commentsCount})`}
        actions={
          <Button
            size="xs"
            variant="ghost-muted"
            className="shrink-0"
            aria-label={
              commentOrder === "newest"
                ? "Show oldest comments first"
                : "Show newest comments first"
            }
            onClick={() => setCommentOrder((value) => (value === "newest" ? "oldest" : "newest"))}
          >
            <ArrowDownUpIcon aria-hidden className="size-3" />
            {commentOrder === "newest" ? "Newest first" : "Oldest first"}
          </Button>
        }
      >
        {commentsResult === null ? (
          comments.error ? (
            <PullRequestActivityUnavailableState
              compact
              title="Could not load comments"
              error={comments.error}
              onRetry={comments.refresh}
            />
          ) : (
            <PullRequestConversationGhost />
          )
        ) : (
          <>
            {commentsResult.truncated ? (
              <p className="mb-2 rounded-md border border-warning/30 bg-warning-surface px-2 py-1.5 text-xs">
                This conversation is longer than this page reads in one go.{" "}
                {commentsResult.comments.length} of {commentsResult.commentCount} are here; open it
                on GitHub to read the rest.
              </p>
            ) : null}
            {orderedComments.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">No comments yet.</p>
            ) : (
              <div className="space-y-3">
                {orderedComments.map((comment) => (
                  <IssueCommentCard
                    key={`${issue.url}:${comment.id}`}
                    comment={comment}
                    issue={issue}
                    reference={reference}
                    environmentId={environmentId}
                    threadRef={threadRef}
                    cwd={cwd}
                    canReact={canReact}
                    canManage={issue.viewer !== undefined && comment.author?.login === issue.viewer}
                    onActed={() => {
                      comments.refresh();
                      onRefresh();
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </Section>
    </div>
  );
}

function IssueCommentCard({
  comment,
  issue,
  reference,
  environmentId,
  threadRef,
  cwd,
  canReact,
  canManage,
  onActed,
}: {
  comment: IssueComment;
  issue: IssueDetail;
  reference: IssueRef;
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef | null;
  cwd: string;
  canReact: boolean;
  /** The reader wrote it, so they may rewrite or delete it. */
  canManage: boolean;
  onActed: () => void;
}) {
  const update = useAtomCommand(issueEnvironment.commentUpdate, { reportFailure: false });
  const remove = useAtomCommand(issueEnvironment.commentDelete, { reportFailure: false });
  const reactionUpdate = useAtomCommand(issueEnvironment.reactionUpdate, { reportFailure: false });
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<"save" | "delete" | null>(null);

  const save = async (body: string) => {
    if (pending !== null) return;
    setPending("save");
    const result = await update({
      environmentId,
      input: { ...reference, commentId: comment.id, body },
    });
    setPending(null);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: "Could not save the comment" });
      return;
    }
    setEditing(false);
    onActed();
  };

  const deleteComment = async () => {
    if (pending !== null) return;
    const confirmed = await (readLocalApi()?.dialogs.confirm("Delete this comment?", {
      variant: "destructive",
    }) ?? Promise.resolve(false));
    if (!confirmed) return;
    setPending("delete");
    const result = await remove({
      environmentId,
      input: { ...reference, commentId: comment.id },
    });
    setPending(null);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: "Could not delete the comment" });
      return;
    }
    onActed();
  };

  return (
    <article
      // Offscreen comments skip style, layout and paint, as the pull request conversation does.
      className="group rounded-lg border border-border/60 bg-background [contain-intrinsic-block-size:160px] [content-visibility:auto]"
    >
      <div className="flex flex-wrap items-start gap-2 rounded-t-lg bg-muted/25 px-3 py-2.5">
        <CommentIdentity comment={comment} detail={issue} />
        {canManage ? (
          <span className="flex shrink-0 opacity-0 transition-opacity pointer-coarse:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none">
            <Button
              size="icon-xs"
              variant="ghost-destructive"
              aria-label={pending === "delete" ? "Deleting comment" : "Delete comment"}
              disabled={pending !== null}
              onClick={() => void deleteComment()}
            >
              <Trash2Icon aria-hidden className="size-3" />
            </Button>
          </span>
        ) : null}
        <ReactionBar
          className="ml-auto justify-end"
          reactions={comment.reactions ?? []}
          canReact={canReact}
          onSetReaction={async (content, reacted) => {
            const result = await reactionUpdate({
              environmentId,
              input: { ...reference, subjectId: comment.id, content, reacted },
            });
            if (result._tag === "Failure") return false;
            onActed();
            return true;
          }}
        />
      </div>
      {editing ? (
        <PullRequestMarkdownEditor
          className="px-3 py-3"
          value={comment.body}
          cwd={cwd}
          environmentId={environmentId}
          threadRef={threadRef}
          label="Edit comment"
          saving={pending === "save"}
          onSave={(body) => void save(body)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="flex items-start gap-1 px-3 py-3">
          <PullRequestCommentBody
            className="min-w-0 flex-1"
            text={comment.body}
            cwd={cwd}
            environmentId={environmentId}
            threadRef={threadRef}
          />
          {canManage ? (
            <PullRequestEditButton aria-label="Edit comment" onClick={() => setEditing(true)} />
          ) : null}
        </div>
      )}
    </article>
  );
}
