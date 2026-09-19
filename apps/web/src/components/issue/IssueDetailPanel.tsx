import type {
  EnvironmentId,
  IssueComment,
  IssueLinkedWork,
  IssueRef,
  IssueReactionContent,
  IssueWorktreeDeletePreflightResult,
  IssueWorktreeDeleteResult,
  IssueWorktreePrepareResult,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import * as Cause from "effect/Cause";
import {
  CheckIcon,
  CircleAlertIcon,
  CircleDotIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  LinkIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  SendIcon,
  SquarePenIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import ChatMarkdown from "../ChatMarkdown";
import {
  issueEnvironment,
  useIssueCandidates,
  useIssueComments,
  useIssueDetail,
} from "~/state/issues";
import { refreshEnvironmentShell } from "~/state/shell";
import { useAtomCommand } from "~/state/use-atom-command";
import { useThreadShells } from "~/state/entities";
import { Button } from "../ui/button";
import { IssueLabelPill } from "./IssueLabelPill";
import { Badge } from "../ui/badge";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { issueWorktreeIsLinked } from "./issue.logic";

const REACTION_CONTENT: readonly IssueReactionContent[] = [
  "thumbs-up",
  "heart",
  "hooray",
  "rocket",
  "eyes",
];

function displayReaction(content: IssueReactionContent): string {
  return content === "thumbs-up"
    ? "Like"
    : content.charAt(0).toUpperCase() + content.slice(1).replace("-", " ");
}

type CloseReason = "completed" | "not-planned" | "duplicate";

const CLOSE_REASON_LABELS: Record<CloseReason, string> = {
  completed: "Completed",
  "not-planned": "Not planned",
  duplicate: "Duplicate",
};

const CLOSE_REASONS: readonly CloseReason[] = ["completed", "not-planned", "duplicate"];

function failureDetail(cause: unknown): string {
  let error = cause;
  if (cause !== undefined) {
    try {
      error = Cause.squash(cause as Cause.Cause<unknown>);
    } catch {
      error = cause;
    }
  }
  if (typeof error === "string") return error.trim();
  if (error && typeof error === "object") {
    if ("detail" in error && typeof error.detail === "string") return error.detail.trim();
    if ("message" in error && typeof error.message === "string") return error.message.trim();
  }
  return error instanceof Error ? error.message.trim() : "";
}

function formatActionError(fallback: string, detail: unknown): string {
  const message = failureDetail(detail)
    .replace(/^Issue operation [^:]+ failed:\s*/i, "")
    .trim();
  if (message.length === 0) return `${fallback}. Try again.`;
  const sentence = /[.!?]$/.test(message) ? message : `${message}.`;
  return `${fallback}: ${sentence}${/try again/i.test(message) ? "" : " Try again."}`;
}

function errorMessage(
  result: { readonly _tag: string; readonly cause?: unknown },
  fallback: string,
): string {
  if (result._tag !== "Failure") return "";
  return formatActionError(fallback, result.cause);
}

function isInterruptedAction(result: { readonly _tag: string; readonly cause?: unknown }): boolean {
  return (
    result._tag === "Failure" &&
    result.cause !== undefined &&
    Cause.hasInterruptsOnly(result.cause as Cause.Cause<unknown>)
  );
}

type ScopedActionOperation = () => Promise<{
  readonly _tag: string;
  readonly value?: unknown;
  readonly cause?: unknown;
}>;

function useScopedActions() {
  const [pendingScopes, setPendingScopes] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(
    () => new Map<string, string>(),
  );
  const pendingRef = useRef<Set<string>>(new Set());

  const hasPending = (scope: string): boolean => pendingScopes.has(scope);
  const errorFor = (scope: string): string | null => errors.get(scope) ?? null;
  const run = useCallback(
    async (
      scope: string,
      fallback: string,
      operation: ScopedActionOperation,
      onSuccess?: (value: unknown) => void,
    ): Promise<boolean> => {
      if (pendingRef.current.has(scope)) return false;
      pendingRef.current.add(scope);
      setPendingScopes((current) => {
        const next = new Set(current);
        next.add(scope);
        return next;
      });
      setErrors((current) => {
        if (!current.has(scope)) return current;
        const next = new Map(current);
        next.delete(scope);
        return next;
      });
      try {
        const result = await operation();
        if (result._tag === "Success") {
          onSuccess?.(result.value);
          return true;
        }
        if (!isInterruptedAction(result)) {
          setErrors((current) => new Map(current).set(scope, errorMessage(result, fallback)));
        }
        return false;
      } catch (cause) {
        setErrors((current) => new Map(current).set(scope, formatActionError(fallback, cause)));
        return false;
      } finally {
        pendingRef.current.delete(scope);
        setPendingScopes((current) => {
          const next = new Set(current);
          next.delete(scope);
          return next;
        });
      }
    },
    [],
  );

  return { pendingScopes, hasPending, errorFor, run };
}

function ActionFeedback({
  pending,
  pendingLabel,
  error,
}: {
  readonly pending: boolean;
  readonly pendingLabel: string;
  readonly error: string | null;
}) {
  if (!pending && !error) return null;
  return pending ? (
    <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
      {pendingLabel}
    </p>
  ) : (
    <p className="text-xs text-destructive" role="alert">
      {error}
    </p>
  );
}

export interface IssueDetailPanelProps {
  readonly environmentId: EnvironmentId;
  readonly reference: IssueRef;
  readonly onActed?: () => void;
  readonly onBack?: () => void;
}

export function IssueDetailPanel({
  environmentId,
  reference,
  onActed,
  onBack,
}: IssueDetailPanelProps) {
  const detailQuery = useIssueDetail({ environmentId, input: reference });
  const commentsQuery = useIssueComments({ environmentId, input: reference });
  const update = useAtomCommand(issueEnvironment.update, { reportFailure: false });
  const close = useAtomCommand(issueEnvironment.close, { reportFailure: false });
  const reopen = useAtomCommand(issueEnvironment.reopen, { reportFailure: false });
  const commentCreate = useAtomCommand(issueEnvironment.commentCreate, { reportFailure: false });
  const reactionUpdate = useAtomCommand(issueEnvironment.reactionUpdate, { reportFailure: false });
  const actions = useScopedActions();
  const updatePending = actions.hasPending("update");
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [labels, setLabels] = useState("");
  const [assignees, setAssignees] = useState("");
  const [comment, setComment] = useState("");
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  const issue = detailQuery.data;
  const labelCandidatesQuery = useIssueCandidates(
    editing
      ? {
          environmentId,
          input: { ...reference, kind: "labels", limit: 100 },
        }
      : null,
  );
  const labelColors = new Map(
    labelCandidatesQuery.data?._tag === "labels"
      ? labelCandidatesQuery.data.candidates.map((candidate) => [candidate.name, candidate.color])
      : (issue?.labels.map((label) => [label.name, label.color]) ?? []),
  );

  useEffect(() => {
    if (!issue || editing) return;
    setTitle(issue.title);
    setBody(issue.body);
    setLabels(issue.labels.map((label) => label.name).join(", "));
    setAssignees(issue.assignees.map((assignee) => assignee.login).join(", "));
  }, [editing, issue]);

  const refreshIssue = () => {
    detailQuery.refresh();
    refreshEnvironmentShell(environmentId);
    onActed?.();
  };

  const runMutation = (
    scope: string,
    fallback: string,
    operation: ScopedActionOperation,
    onSuccess?: () => void,
  ) =>
    actions.run(scope, fallback, operation, () => {
      refreshIssue();
      onSuccess?.();
    });

  const save = async () => {
    const saved = await runMutation("update", "Unable to save issue", () =>
      update({
        environmentId,
        input: {
          ...reference,
          title: title.trim(),
          body,
          labels: labels
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          assignees: assignees
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        },
      }),
    );
    if (saved) setEditing(false);
  };

  const createComment = () => {
    void actions.run(
      "comment-create",
      "Unable to add comment",
      () =>
        commentCreate({
          environmentId,
          input: { ...reference, body: comment },
        }),
      () => {
        setComment("");
        commentsQuery.refresh();
        refreshIssue();
      },
    );
  };

  const openExternal = () => {
    if (!issue) return;
    void (readLocalApi()?.shell.openExternal(issue.url) ?? Promise.resolve());
  };

  if (detailQuery.isPending && issue === null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Spinner aria-label="Loading issue" />
      </div>
    );
  }
  if (issue === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <CircleAlertIcon className="size-5 text-destructive" />
        <p className="text-sm text-muted-foreground" role="alert">
          {detailQuery.error
            ? formatActionError("Unable to load issue", detailQuery.error)
            : "Unable to load issue. Try again."}
        </p>
        <Button size="sm" variant="outline" onClick={detailQuery.refresh}>
          <RefreshCwIcon /> Try again
        </Button>
      </div>
    );
  }

  const commentsResult = commentsQuery.data;
  const comments = commentsResult?.comments ?? [];
  const permissions = issue.viewerPermissions;
  const issueStatePending = actions.hasPending("issue-state");
  const commentCreatePending = actions.hasPending("comment-create");
  const reactionContents =
    issue.reactions && issue.reactions.length > 0
      ? issue.reactions.map((reaction) => reaction.content)
      : REACTION_CONTENT;
  const reactionPending = reactionContents.some((content) =>
    actions.hasPending(`reaction:${content}`),
  );
  const reactionError =
    reactionContents
      .map((content) => actions.errorFor(`reaction:${content}`))
      .find((message): message is string => message !== null) ?? null;
  const commentsInitialLoading = commentsResult === null && commentsQuery.error === null;
  const commentsRefreshing = commentsResult !== null && commentsQuery.isPending;
  const commentsError = commentsQuery.error
    ? formatActionError("Unable to load comments", commentsQuery.error)
    : null;
  const issueStateError = actions.errorFor("issue-state");

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <header className="@container/issue-header grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {onBack ? (
              <Button size="icon-xs" variant="ghost" aria-label="Back to issues" onClick={onBack}>
                <XIcon />
              </Button>
            ) : null}
            <span
              className={cn(
                "inline-flex items-center gap-1 font-medium",
                issue.state === "open"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground",
              )}
            >
              <CircleDotIcon className="size-3.5" /> {issue.state === "open" ? "Open" : "Closed"}
            </span>
            <span>#{issue.number}</span>
            <span>{issue.repository}</span>
            {issue.linkedWork ? (
              <Badge size="sm" variant="secondary">
                <LinkIcon /> Linked
              </Badge>
            ) : null}
          </div>
          {editing ? (
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-label="Issue title"
              disabled={updatePending}
            />
          ) : (
            <h2 className="text-base font-semibold leading-snug wrap-break-word">{issue.title}</h2>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Updated {new Date(issue.updatedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="xs"
            disabled={worktreeOpen}
            onClick={() => setWorktreeOpen(true)}
            aria-label="Work on issue"
          >
            <GitBranchIcon />
            <span className="@max-[30rem]/issue-header:hidden">Work on issue</span>
          </Button>
          <Menu>
            <MenuTrigger
              render={
                <Button size="icon-xs" variant="ghost-muted" aria-label="More issue actions" />
              }
            >
              <MoreHorizontalIcon />
            </MenuTrigger>
            <MenuPopup align="end" side="bottom" className="min-w-52">
              <MenuItem onClick={openExternal}>
                <ExternalLinkIcon />
                Open issue on GitHub
              </MenuItem>
              {permissions?.update !== false ? (
                <MenuItem onClick={() => setEditing((value) => !value)} disabled={updatePending}>
                  <PencilIcon />
                  {editing ? "Cancel editing" : "Edit issue"}
                </MenuItem>
              ) : null}
              {issue.state === "open" ? (
                CLOSE_REASONS.map((reason) => (
                  <MenuItem
                    key={reason}
                    variant="destructive"
                    disabled={permissions?.close === false || issueStatePending}
                    onClick={() =>
                      void runMutation("issue-state", "Unable to close issue", () =>
                        close({ environmentId, input: { ...reference, reason } }),
                      )
                    }
                  >
                    <CheckIcon />
                    Close as {CLOSE_REASON_LABELS[reason].toLowerCase()}
                  </MenuItem>
                ))
              ) : (
                <MenuItem
                  disabled={permissions?.reopen === false || issueStatePending}
                  onClick={() =>
                    void runMutation("issue-state", "Unable to reopen issue", () =>
                      reopen({ environmentId, input: reference }),
                    )
                  }
                >
                  <RotateCcwIcon />
                  Reopen issue
                </MenuItem>
              )}
            </MenuPopup>
          </Menu>
        </div>
        <div className="col-span-2">
          {issue.linkedWork ? (
            <p className="text-xs text-muted-foreground">
              Linked work:{" "}
              {issue.linkedWork.branch ?? issue.linkedWork.worktreePath ?? "Linked work"}
            </p>
          ) : null}
          <ActionFeedback
            pending={issueStatePending}
            pendingLabel={issue.state === "open" ? "Closing issue…" : "Reopening issue…"}
            error={issueStateError}
          />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="w-full space-y-6 px-5 pt-5 pb-16">
          {editing ? (
            <section className="space-y-3 rounded-xl border bg-muted/20 p-4">
              <label className="block text-xs font-medium">
                Body
                <Textarea
                  className="mt-1"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  rows={10}
                  disabled={updatePending}
                />
              </label>
              <label className="block text-xs font-medium">
                Labels
                <Textarea
                  className="mt-1 min-h-8"
                  value={labels}
                  onChange={(event) => setLabels(event.target.value)}
                  rows={1}
                  placeholder="bug, enhancement"
                  disabled={updatePending}
                />
                <span className="mt-2 flex flex-wrap gap-1">
                  {labels
                    .split(",")
                    .map((name) => name.trim())
                    .filter(Boolean)
                    .map((name) => (
                      <IssueLabelPill key={name} name={name} color={labelColors.get(name)} />
                    ))}
                </span>
              </label>
              <label className="block text-xs font-medium">
                Assignees
                <Textarea
                  className="mt-1 min-h-8"
                  value={assignees}
                  onChange={(event) => setAssignees(event.target.value)}
                  rows={1}
                  placeholder="github-login"
                  disabled={updatePending}
                />
              </label>
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(false)}
                  disabled={updatePending}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => void save()}
                  disabled={title.trim().length === 0 || updatePending}
                  aria-busy={updatePending}
                >
                  {updatePending ? (
                    <>
                      <Spinner className="size-3.5" aria-label="Saving issue" /> Saving…
                    </>
                  ) : (
                    "Save changes"
                  )}
                </Button>
              </div>
              <ActionFeedback
                pending={updatePending}
                pendingLabel="Saving issue…"
                error={actions.errorFor("update")}
              />
            </section>
          ) : (
            <section className="rounded-xl border bg-card/30 p-5">
              <ChatMarkdown
                text={issue.body || "_No description provided._"}
                cwd={issue.workspaceRoot}
                environmentId={environmentId}
              />
            </section>
          )}

          <section className="flex flex-wrap items-center gap-2">
            {issue.labels.map((label) => (
              <IssueLabelPill key={label.name} name={label.name} color={label.color} />
            ))}
            {issue.assignees.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                Assigned to {issue.assignees.map((assignee) => assignee.login).join(", ")}
              </span>
            ) : null}
          </section>

          {issue.reactions && issue.reactions.length > 0 ? (
            <section className="flex flex-wrap gap-2">
              {issue.reactions.map((reaction) => {
                const scope = `reaction:${reaction.content}`;
                const pending = actions.hasPending(scope);
                return (
                  <Button
                    key={reaction.content}
                    size="xs"
                    variant={reaction.viewerHasReacted ? "secondary" : "outline"}
                    disabled={permissions?.react === false || pending}
                    onClick={() =>
                      void runMutation(scope, "Unable to update reaction", () =>
                        reactionUpdate({
                          environmentId,
                          input: {
                            ...reference,
                            content: reaction.content,
                            reacted: !reaction.viewerHasReacted,
                          },
                        }),
                      )
                    }
                    aria-busy={pending}
                  >
                    {pending ? (
                      <Spinner className="size-3.5" aria-label="Updating reaction" />
                    ) : null}
                    {displayReaction(reaction.content)} {reaction.count}
                  </Button>
                );
              })}
              <ActionFeedback
                pending={reactionPending}
                pendingLabel="Updating reaction…"
                error={reactionError}
              />
            </section>
          ) : (
            <section className="flex flex-wrap gap-2">
              {REACTION_CONTENT.map((content) => {
                const scope = `reaction:${content}`;
                const pending = actions.hasPending(scope);
                return (
                  <Button
                    key={content}
                    size="xs"
                    variant="outline"
                    disabled={permissions?.react === false || pending}
                    onClick={() =>
                      void runMutation(scope, "Unable to update reaction", () =>
                        reactionUpdate({
                          environmentId,
                          input: { ...reference, content, reacted: true },
                        }),
                      )
                    }
                    aria-busy={pending}
                  >
                    {pending ? (
                      <Spinner className="size-3.5" aria-label="Updating reaction" />
                    ) : null}
                    {displayReaction(content)}
                  </Button>
                );
              })}
              <ActionFeedback
                pending={reactionPending}
                pendingLabel="Updating reaction…"
                error={reactionError}
              />
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <MessageCircleIcon className="size-4" /> Comments{" "}
                <span className="font-normal text-muted-foreground">{issue.commentsCount}</span>
              </h3>
              <div className="flex items-center gap-2">
                {commentsRefreshing ? (
                  <span className="text-xs text-muted-foreground" role="status" aria-live="polite">
                    Refreshing comments…
                  </span>
                ) : null}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={commentsQuery.isPending ? "Refreshing comments" : "Refresh comments"}
                  onClick={commentsQuery.refresh}
                  disabled={commentsQuery.isPending}
                  aria-busy={commentsQuery.isPending}
                >
                  {commentsQuery.isPending ? (
                    <Spinner className="size-4" aria-label="Refreshing comments" />
                  ) : (
                    <RefreshCwIcon />
                  )}
                </Button>
              </div>
            </div>
            {commentsResult === null ? (
              commentsInitialLoading ? (
                <div
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                  role="status"
                  aria-live="polite"
                >
                  <Spinner className="size-4" aria-label="Loading comments" /> Loading comments…
                </div>
              ) : commentsError ? (
                <div className="flex items-center gap-2 text-sm text-destructive" role="alert">
                  <span>{commentsError}</span>
                  <Button size="xs" variant="outline" onClick={commentsQuery.refresh}>
                    Try again
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-destructive" role="alert">
                  <span>Unable to load comments. Try again.</span>
                  <Button size="xs" variant="outline" onClick={commentsQuery.refresh}>
                    Try again
                  </Button>
                </div>
              )
            ) : (
              <>
                {commentsError ? (
                  <div className="flex items-center gap-2 text-sm text-destructive" role="alert">
                    <span>{commentsError}</span>
                    <Button size="xs" variant="outline" onClick={commentsQuery.refresh}>
                      Try again
                    </Button>
                  </div>
                ) : null}
                {comments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No comments yet.</p>
                ) : (
                  comments.map((entry) => (
                    <IssueCommentRow
                      key={entry.id}
                      comment={entry}
                      reference={reference}
                      environmentId={environmentId}
                      canManage={issue.viewer !== undefined && entry.author?.login === issue.viewer}
                      onActed={() => {
                        commentsQuery.refresh();
                        detailQuery.refresh();
                      }}
                    />
                  ))
                )}
              </>
            )}
            <div className="space-y-2">
              <Textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Leave a comment"
                rows={3}
                disabled={commentCreatePending}
              />
              <Button
                size="sm"
                disabled={
                  comment.trim().length === 0 ||
                  permissions?.comment === false ||
                  commentCreatePending
                }
                onClick={createComment}
                aria-busy={commentCreatePending}
              >
                {commentCreatePending ? (
                  <>
                    <Spinner className="size-3.5" aria-label="Adding comment" /> Commenting…
                  </>
                ) : (
                  <>
                    <SendIcon /> Comment
                  </>
                )}
              </Button>
              <ActionFeedback
                pending={commentCreatePending}
                pendingLabel="Adding comment…"
                error={actions.errorFor("comment-create")}
              />
            </div>
          </section>
        </div>
      </div>
      <IssueWorktreeDialog
        open={worktreeOpen}
        onOpenChange={setWorktreeOpen}
        environmentId={environmentId}
        reference={reference}
        linkedWork={issue.linkedWork ?? null}
        canLink={permissions?.link !== false}
        onActed={refreshIssue}
      />
    </div>
  );
}

function IssueCommentRow({
  comment,
  reference,
  environmentId,
  canManage,
  onActed,
}: {
  readonly comment: IssueComment;
  readonly reference: IssueRef;
  readonly environmentId: EnvironmentId;
  readonly canManage: boolean;
  readonly onActed: () => void;
}) {
  const update = useAtomCommand(issueEnvironment.commentUpdate, { reportFailure: false });
  const remove = useAtomCommand(issueEnvironment.commentDelete, { reportFailure: false });
  const reactionUpdate = useAtomCommand(issueEnvironment.reactionUpdate, { reportFailure: false });
  const actions = useScopedActions();
  const [body, setBody] = useState(comment.body);
  const [editing, setEditing] = useState(false);
  const updatePending = actions.hasPending("update");
  const deletePending = actions.hasPending("delete");
  const reactionEntries = comment.reactions ?? [];
  const reactionPending = reactionEntries.some((reaction) =>
    actions.hasPending(`reaction:${reaction.content}`),
  );
  const reactionError =
    reactionEntries
      .map((reaction) => actions.errorFor(`reaction:${reaction.content}`))
      .find((message): message is string => message !== null) ?? null;

  const save = () => {
    void actions.run(
      "update",
      "Unable to save comment",
      () =>
        update({
          environmentId,
          input: { ...reference, commentId: comment.id, body },
        }),
      () => {
        setEditing(false);
        onActed();
      },
    );
  };

  const deleteComment = async () => {
    if (deletePending || updatePending) return;
    const confirmed = await (readLocalApi()?.dialogs.confirm("Delete this issue comment?", {
      variant: "destructive",
    }) ?? Promise.resolve(false));
    if (!confirmed) return;
    void actions.run(
      "delete",
      "Unable to delete comment",
      () => remove({ environmentId, input: { ...reference, commentId: comment.id } }),
      onActed,
    );
  };

  return (
    <article className="rounded-xl border bg-card/20 p-4">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{comment.author?.login ?? "A contributor"}</span>
        <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time>
      </div>
      {editing ? (
        <>
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            disabled={updatePending}
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button
              size="xs"
              variant="ghost"
              disabled={updatePending}
              onClick={() => {
                setBody(comment.body);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button
              size="xs"
              disabled={body.trim().length === 0 || updatePending}
              onClick={save}
              aria-busy={updatePending}
            >
              {updatePending ? (
                <>
                  <Spinner className="size-3.5" aria-label="Saving comment" /> Saving…
                </>
              ) : (
                "Save"
              )}
            </Button>
          </div>
          <ActionFeedback
            pending={updatePending}
            pendingLabel="Saving comment…"
            error={actions.errorFor("update")}
          />
        </>
      ) : (
        <ChatMarkdown text={comment.body} cwd={undefined} environmentId={environmentId} />
      )}
      {comment.reactions?.length ? (
        <>
          <div className="mt-3 flex flex-wrap gap-1">
            {comment.reactions.map((reaction) => {
              const scope = `reaction:${reaction.content}`;
              const pending = actions.hasPending(scope);
              return (
                <Button
                  key={reaction.content}
                  size="xs"
                  variant={reaction.viewerHasReacted ? "secondary" : "outline"}
                  disabled={pending}
                  onClick={() =>
                    void actions.run(
                      scope,
                      "Unable to update comment reaction",
                      () =>
                        reactionUpdate({
                          environmentId,
                          input: {
                            ...reference,
                            subjectId: comment.id,
                            content: reaction.content,
                            reacted: !reaction.viewerHasReacted,
                          },
                        }),
                      onActed,
                    )
                  }
                  aria-busy={pending}
                >
                  {pending ? (
                    <Spinner className="size-3.5" aria-label="Updating comment reaction" />
                  ) : null}
                  {displayReaction(reaction.content)} {reaction.count}
                </Button>
              );
            })}
          </div>
          <ActionFeedback
            pending={reactionPending}
            pendingLabel="Updating comment reaction…"
            error={reactionError}
          />
        </>
      ) : null}
      {canManage ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Edit comment"
            onClick={() => setEditing(true)}
            disabled={updatePending || deletePending}
          >
            <PencilIcon />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Delete comment"
            onClick={() => void deleteComment()}
            disabled={deletePending || updatePending}
            aria-busy={deletePending}
          >
            {deletePending ? (
              <Spinner className="size-3.5" aria-label="Deleting comment" />
            ) : (
              <Trash2Icon />
            )}
          </Button>
          <ActionFeedback
            pending={deletePending}
            pendingLabel="Deleting comment…"
            error={actions.errorFor("delete")}
          />
        </div>
      ) : null}
    </article>
  );
}

export interface IssueWorktreeDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly reference: IssueRef;
  readonly linkedWork: IssueLinkedWork | null;
  readonly canLink?: boolean;
  readonly onActed?: () => void;
}

export function IssueWorktreeDialog({
  open,
  onOpenChange,
  environmentId,
  reference,
  linkedWork,
  canLink = true,
  onActed,
}: IssueWorktreeDialogProps) {
  const threads = useThreadShells();
  const prepare = useAtomCommand(issueEnvironment.worktreePrepare, { reportFailure: false });
  const preflight = useAtomCommand(issueEnvironment.worktreeDeletePreflight, {
    reportFailure: false,
  });
  const remove = useAtomCommand(issueEnvironment.worktreeDelete, { reportFailure: false });
  const replace = useAtomCommand(issueEnvironment.worktreeReplace, { reportFailure: false });
  const newThread = useNewThreadHandler();
  const actions = useScopedActions();
  const [name, setName] = useState(`issue-${reference.number}`);
  const [baseBranch, setBaseBranch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preflightResult, setPreflightResult] = useState<IssueWorktreeDeletePreflightResult | null>(
    null,
  );
  const [deleteResult, setDeleteResult] = useState<IssueWorktreeDeleteResult | null>(null);
  const [forceAcknowledged, setForceAcknowledged] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [worktreeQuery, setWorktreeQuery] = useState("");
  const worktrees = useMemo(
    () =>
      threads.filter(
        (thread) =>
          thread.environmentId === environmentId &&
          thread.projectId === reference.projectId &&
          thread.worktreePath,
      ),
    [environmentId, reference.projectId, threads],
  );
  const selectedItems = worktrees.filter((thread) => selected.has(thread.id));
  const visibleWorktrees = useMemo(() => {
    const query = worktreeQuery.trim().toLowerCase();
    if (query.length === 0) return worktrees;
    return worktrees.filter((thread) =>
      [thread.title, thread.branch ?? "", thread.worktreePath ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [worktreeQuery, worktrees]);
  const selectedInputs = selectedItems.map((thread) => ({
    threadId: thread.id,
    projectId: thread.projectId,
    path: thread.worktreePath!,
  }));
  const createPending = actions.hasPending("create");
  const replacePending = actions.hasPending("replace");
  const preflightPending = actions.hasPending("preflight");
  const deletePending = actions.hasPending("delete");
  const openWorktreePending = actions.hasPending("open-worktree");

  const prepareWorktree = () => {
    const trimmedName = name.trim();
    if (trimmedName.length === 0 || createPending) return;
    setNotice(null);
    void actions.run(
      "create",
      "Unable to create worktree",
      async () => {
        const projectRef = scopeProjectRef(environmentId, reference.projectId);
        const opened = canLink ? await newThread(projectRef) : null;
        if (canLink && opened === null) throw new Error("Unable to open a thread for the worktree");
        const result = await prepare({
          environmentId,
          input: {
            ...reference,
            name: trimmedName,
            ...(baseBranch.trim() ? { baseBranch: baseBranch.trim() } : {}),
            ...(opened ? { threadId: opened.threadId } : {}),
          },
        });
        if (result._tag === "Failure" || !opened) return result;
        const { worktree } = result.value as IssueWorktreePrepareResult;
        const pointed = await newThread(projectRef, {
          branch: worktree.branch,
          worktreePath: worktree.worktreePath,
          envMode: "worktree",
        });
        if (pointed === null) throw new Error("Worktree created, but the new thread did not open");
        return result;
      },
      () => {
        setNotice(canLink ? "Worktree created and linked." : "Worktree created.");
        onActed?.();
      },
    );
  };

  const checkDelete = () => {
    if (selectedInputs.length === 0 || preflightPending) return;
    setNotice(null);
    void actions.run(
      "preflight",
      "Unable to check worktrees",
      () =>
        preflight({
          environmentId,
          input: { selections: selectedInputs },
        }),
      (value) => {
        setPreflightResult(value as IssueWorktreeDeletePreflightResult);
        setDeleteResult(null);
        setForceAcknowledged(false);
        setNotice("Worktree check complete.");
      },
    );
  };

  const deleteWorktrees = () => {
    if (!preflightResult || selectedInputs.length === 0 || deletePending || preflightPending)
      return;
    setNotice(null);
    void actions.run(
      "delete",
      "Unable to delete worktrees",
      () =>
        remove({
          environmentId,
          input: {
            selections: selectedInputs,
            forceAcknowledged,
          },
        }),
      (value) => {
        setDeleteResult(value as IssueWorktreeDeleteResult);
        setNotice("Worktree deletion finished.");
        onActed?.();
      },
    );
  };

  const replaceWorktree = () => {
    const trimmedName = name.trim();
    if (trimmedName.length === 0 || replacePending) return;
    setNotice(null);
    void actions.run(
      "replace",
      "Unable to replace worktree",
      () =>
        replace({
          environmentId,
          input: {
            ...reference,
            name: trimmedName,
            ...(baseBranch.trim() ? { baseBranch: baseBranch.trim() } : {}),
            ...(linkedWork?.worktreePath ? { worktreePath: linkedWork.worktreePath } : {}),
          },
        }),
      () => {
        setNotice("Linked worktree replaced.");
        onActed?.();
      },
    );
  };

  const openWorktree = (target: (typeof worktrees)[number]) => {
    if (openWorktreePending) return;
    setNotice(null);
    void actions.run(
      "open-worktree",
      "Unable to open a new thread in this worktree",
      async () => {
        const opened = await newThread(scopeProjectRef(environmentId, target.projectId), {
          branch: target.branch,
          worktreePath: target.worktreePath,
          envMode: "worktree",
        });
        if (opened === null) throw new Error("The new thread did not open");
        return { _tag: "Success" };
      },
      () => {
        onOpenChange(false);
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Work on issue #{reference.number}</DialogTitle>
          <DialogDescription>
            {canLink
              ? "Create and link a worktree, or continue in an existing one."
              : "Create a worktree, or continue in an existing one."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-5">
          <section className="space-y-3">
            <label className="block text-sm font-medium">
              Worktree name
              <Input
                className="mt-1"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={createPending || replacePending}
              />
            </label>
            <label className="block text-sm font-medium">
              Base branch <span className="font-normal text-muted-foreground">(optional)</span>
              <Input
                className="mt-1"
                value={baseBranch}
                onChange={(event) => setBaseBranch(event.target.value)}
                placeholder="main"
                disabled={createPending || replacePending}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={prepareWorktree}
                disabled={name.trim().length === 0 || createPending}
                aria-busy={createPending}
              >
                {createPending ? (
                  <>
                    <Spinner className="size-3.5" aria-label="Creating worktree" /> Creating…
                  </>
                ) : (
                  <>
                    <GitBranchIcon /> {canLink ? "Create and link" : "Create worktree"}
                  </>
                )}
              </Button>
              {linkedWork ? (
                <Button
                  variant="outline"
                  onClick={replaceWorktree}
                  disabled={name.trim().length === 0 || replacePending}
                  aria-busy={replacePending}
                >
                  {replacePending ? (
                    <>
                      <Spinner className="size-3.5" aria-label="Replacing worktree" /> Replacing…
                    </>
                  ) : (
                    <>
                      <RefreshCwIcon /> Replace linked worktree
                    </>
                  )}
                </Button>
              ) : null}
            </div>
            <ActionFeedback
              pending={createPending}
              pendingLabel="Creating worktree…"
              error={actions.errorFor("create")}
            />
            <ActionFeedback
              pending={replacePending}
              pendingLabel="Replacing detached worktree…"
              error={actions.errorFor("replace")}
            />
          </section>
          {worktrees.length > 0 ? (
            <section className="space-y-2">
              <div>
                <h3 className="text-sm font-semibold">
                  Existing worktrees{" "}
                  <span className="text-muted-foreground">({worktrees.length})</span>
                </h3>
                <p className="text-xs text-muted-foreground">
                  Start a new thread in a worktree, or select worktrees to check before deleting.
                </p>
              </div>
              {worktrees.length > 8 ? (
                <label className="relative block">
                  <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="ps-8"
                    value={worktreeQuery}
                    onChange={(event) => setWorktreeQuery(event.target.value)}
                    placeholder="Search worktrees"
                    aria-label="Search worktrees"
                  />
                </label>
              ) : null}
              <div className="max-h-64 space-y-1 overflow-y-auto pe-1">
                {visibleWorktrees.map((thread) => {
                  const linked = issueWorktreeIsLinked(thread, linkedWork);
                  const checkboxId = `issue-worktree-${thread.id}`;
                  return (
                    <div
                      key={thread.id}
                      className="flex items-center gap-2 rounded-lg border p-2 text-sm"
                    >
                      <Checkbox
                        id={checkboxId}
                        checked={selected.has(thread.id)}
                        onCheckedChange={(checked) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (checked === true) next.add(thread.id);
                            else next.delete(thread.id);
                            return next;
                          })
                        }
                        aria-label={`Select ${thread.title}`}
                        disabled={deletePending || preflightPending}
                      />
                      <label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer">
                        <span className="block truncate">{thread.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {thread.branch ?? thread.worktreePath}
                        </span>
                      </label>
                      {linked ? (
                        <Badge size="sm" variant="success">
                          <CheckIcon /> Linked
                        </Badge>
                      ) : null}
                      <Button
                        size="xs"
                        variant="outline"
                        aria-label={`New thread in ${thread.branch ?? thread.title}`}
                        onClick={() => openWorktree(thread)}
                        disabled={openWorktreePending}
                      >
                        <SquarePenIcon /> New thread
                      </Button>
                    </div>
                  );
                })}
                {visibleWorktrees.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No worktrees match “{worktreeQuery.trim()}”.
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={selectedItems.length === 0 || preflightPending}
                  onClick={checkDelete}
                  aria-busy={preflightPending}
                >
                  {preflightPending ? (
                    <>
                      <Spinner className="size-3.5" aria-label="Checking worktrees" /> Checking…
                    </>
                  ) : (
                    <>
                      <Trash2Icon />
                      {selectedItems.length === 0
                        ? "Select worktrees to delete"
                        : `Check ${selectedItems.length} before deleting`}
                    </>
                  )}
                </Button>
              </div>
              <ActionFeedback
                pending={preflightPending}
                pendingLabel="Checking worktrees before deletion…"
                error={actions.errorFor("preflight")}
              />
              <ActionFeedback
                pending={openWorktreePending}
                pendingLabel="Opening a new thread in the selected worktree…"
                error={actions.errorFor("open-worktree")}
              />
            </section>
          ) : (
            <p className="text-sm text-muted-foreground">
              No existing named worktrees for this repository.
            </p>
          )}
          {preflightResult ? (
            <section className="space-y-2 rounded-lg border border-warning/30 bg-warning-surface/20 p-3 text-sm">
              <p>
                {preflightResult.items.length} worktree
                {preflightResult.items.length === 1 ? "" : "s"} checked. Review changed files and
                unpushed commits before continuing.
              </p>
              {preflightResult.items.map((item) => (
                <div key={`${item.threadId}:${item.path}`} className="text-xs">
                  <strong>{item.branch}</strong> · {item.changedFiles.length} changed files ·{" "}
                  {item.unpushedCommitCount} unpushed commits
                  {item.reason ? ` · ${item.reason}` : ""}
                </div>
              ))}
              {preflightResult.items.some((item) => item.requiresForce) ? (
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={forceAcknowledged}
                    onCheckedChange={(checked) => setForceAcknowledged(checked === true)}
                    disabled={deletePending}
                  />
                  I understand force deletion may discard uncommitted work.
                </label>
              ) : null}
              <Button
                size="sm"
                variant="destructive"
                disabled={
                  deletePending ||
                  preflightPending ||
                  (!forceAcknowledged && preflightResult.items.some((item) => item.requiresForce))
                }
                onClick={deleteWorktrees}
                aria-busy={deletePending}
              >
                {deletePending ? (
                  <>
                    <Spinner className="size-3.5" aria-label="Deleting worktrees" /> Deleting…
                  </>
                ) : (
                  "Delete selected worktrees"
                )}
              </Button>
              <ActionFeedback
                pending={deletePending}
                pendingLabel="Deleting selected worktrees…"
                error={actions.errorFor("delete")}
              />
            </section>
          ) : null}
          {deleteResult ? (
            <section className="rounded-lg border border-emerald-500/30 bg-emerald-500/8 p-3 text-sm">
              <p className="font-medium">Deletion results</p>
              {deleteResult.results.map((item) => (
                <p
                  key={`${item.threadId}:${item.path}`}
                  className={
                    item.deleted ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"
                  }
                >
                  {item.deleted ? "Deleted" : "Not deleted"} {item.path}
                  {item.error ? ` · ${item.error}` : ""}
                  {item.detachedWorkspace ? " · thread is now read-only" : ""}
                </p>
              ))}
            </section>
          ) : null}
          {notice ? (
            <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
              {notice}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
