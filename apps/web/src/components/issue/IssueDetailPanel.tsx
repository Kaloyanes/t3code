import type {
  EnvironmentId,
  IssueCloseReason,
  IssueRef,
  IssueRelatedIssue,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CopyIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  LinkIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  TagIcon,
  UsersIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { useRightPanelStore } from "~/rightPanelStore";
import { useProject } from "~/state/entities";
import { issueEnvironment, useIssueComments, useIssueDetail } from "~/state/issues";
import { refreshEnvironmentShell } from "~/state/shell";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { RefreshIcon } from "../ui/refresh-icon";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { useCondensingChrome } from "../workItem/useCondensingChrome";
import { PullRequestActivityUnavailableState } from "../pullRequest/PullRequestActivityUnavailableState";
import { PullRequestEditButton } from "../pullRequest/PullRequestEditButton";
import { GhostBar } from "../pullRequest/PullRequestGhosts";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { showPullRequestLinkContextMenu } from "../pullRequest/pullRequestLinkContextMenu";
import { PullRequestMarkdownContext } from "../pullRequest/PullRequestMarkdown";
import { PullRequestActorLabel, PullRequestMetaLine } from "../pullRequest/pullRequestPresentation";
import { formatActionError } from "./issueActions";
import { issueRepositoryUrl } from "./issue.logic";
import { issueSubIssueProgress } from "./issueDetail.logic";
import { ISSUE_CLOSE_REASON_LABELS, IssueComposer } from "./IssueComposer";
import { ISSUE_STATE_PRESENTATION } from "./issuePresentation";
import { resolveIssueState } from "./IssueStateGlyph";
import { IssueSummaryTab, issueActorProfileUrl } from "./IssueSummaryTab";
import { IssueTimelineTab } from "./IssueTimelineTab";
import { IssueWorktreeDialog } from "./IssueWorktreeDialog";

export { IssueWorktreeDialog, type IssueWorktreeDialogProps } from "./IssueWorktreeDialog";

type DetailTab = "summary" | "timeline";

const TABS: ReadonlyArray<{ value: DetailTab; label: string }> = [
  { value: "summary", label: "Summary" },
  { value: "timeline", label: "Timeline" },
];

const OPEN_ON_GITHUB = "Open on GitHub";

/** The number is a link everywhere it is written, so its right-click copies it. */
const openNumberContextMenu = (event: ReactMouseEvent, url: string): void => {
  event.preventDefault();
  event.stopPropagation();
  void showPullRequestLinkContextMenu({
    url,
    openLabel: OPEN_ON_GITHUB,
    position: { x: event.clientX, y: event.clientY },
  });
};

export interface IssueDetailPanelProps {
  readonly environmentId: EnvironmentId;
  readonly reference: IssueRef;
  readonly onActed?: () => void;
  readonly onBack?: () => void;
  /** The thread this panel sits beside, if any: linked pull requests and issues open beside it. */
  readonly threadRef?: ScopedThreadRef | null;
  /**
   * Opens a related issue from the same repository in whatever holds this panel. Beside a thread
   * they open in its right panel; with neither, they open on GitHub.
   */
  readonly onOpenIssue?: (issue: IssueRef & { readonly url: string }) => void;
}

export function IssueDetailPanel({
  environmentId,
  reference,
  onActed,
  onBack,
  threadRef = null,
  onOpenIssue,
}: IssueDetailPanelProps) {
  const issueKey = `${environmentId}:${reference.projectId}:${reference.host ?? ""}:${reference.repository}#${reference.number}`;
  const detailQuery = useIssueDetail({ environmentId, input: reference });
  const commentsQuery = useIssueComments({ environmentId, input: reference });
  const project = useProject(scopeProjectRef(environmentId, reference.projectId));
  const update = useAtomCommand(issueEnvironment.update, { reportFailure: false });
  const close = useAtomCommand(issueEnvironment.close, { reportFailure: false });
  const reopen = useAtomCommand(issueEnvironment.reopen, { reportFailure: false });
  const navigate = useNavigate();
  const [tab, setTab] = useState<DetailTab>("summary");
  // Like the pull request panel, a visited tab stays mounted behind the active one so its scroll
  // position and rendered markdown survive switching back.
  const [tabMountState, setTabMountState] = useState(() => ({
    key: issueKey,
    tabs: new Set<DetailTab>(["summary"]),
  }));
  const mountedTabs =
    tabMountState.key === issueKey ? tabMountState.tabs : new Set<DetailTab>([tab]);
  useEffect(() => {
    setTabMountState((previous) => {
      if (previous.key !== issueKey) return { key: issueKey, tabs: new Set([tab]) };
      if (previous.tabs.has(tab)) return previous;
      return { key: issueKey, tabs: new Set(previous.tabs).add(tab) };
    });
  }, [issueKey, tab]);
  const { condensed, foldRef, condensedRowRef, onScrollCapture } = useCondensingChrome(tab);
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  // Drafts are scoped to the issue they were typed against: this panel can be handed another one.
  const [titleScope, setTitleScope] = useState<{
    readonly key: string;
    readonly text: string;
  } | null>(null);
  const titleDraft = titleScope?.key === issueKey ? titleScope.text : null;
  const [titleSaving, setTitleSaving] = useState(false);
  const [bodyEditingKey, setBodyEditingKey] = useState<string | null>(null);
  const [statePending, setStatePending] = useState(false);
  const [timelineToken, setTimelineToken] = useState(0);
  const { copyToClipboard } = useCopyToClipboard<string>({
    target: "issue reference",
    onCopy: (label) => toastManager.add({ type: "success", title: `${label} copied` }),
    onError: (error, label) =>
      toastManager.add({
        type: "error",
        title: `Failed to copy ${label}`,
        description: error.message,
      }),
  });
  const issue = detailQuery.data;
  const repositoryUrl = issueRepositoryUrl({
    ...(reference.host === undefined ? {} : { host: reference.host }),
    repository: reference.repository,
  });
  const markdownContext = useMemo(() => ({ repositoryUrl, threadRef }), [repositoryUrl, threadRef]);

  const { refresh: refreshDetail } = detailQuery;
  const refreshIssue = useCallback(() => {
    refreshDetail();
    refreshEnvironmentShell(environmentId);
    setTimelineToken((token) => token + 1);
    onActed?.();
  }, [environmentId, onActed, refreshDetail]);

  const setIssueState = async (change: IssueCloseReason | "reopen"): Promise<boolean> => {
    if (statePending) return false;
    setStatePending(true);
    const result =
      change === "reopen"
        ? await reopen({ environmentId, input: reference })
        : await close({ environmentId, input: { ...reference, reason: change } });
    setStatePending(false);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: change === "reopen" ? "Could not reopen this issue" : "Could not close this issue",
        description: formatActionError("The host refused it", result.cause),
      });
      return false;
    }
    refreshIssue();
    return true;
  };

  const saveTitle = async (next: string) => {
    const title = next.trim();
    if (issue === null || titleSaving) return;
    if (title.length === 0 || title === issue.title) {
      setTitleScope(null);
      return;
    }
    setTitleSaving(true);
    const result = await update({ environmentId, input: { ...reference, title } });
    setTitleSaving(false);
    if (result._tag === "Failure") {
      // The draft stays open with the words still in it.
      toastManager.add({
        type: "error",
        title: "The title could not be saved",
        description: formatActionError("The host refused the new title", result.cause),
      });
      return;
    }
    setTitleScope(null);
    refreshIssue();
  };

  const openRelatedIssue = (related: IssueRelatedIssue) => {
    const sameRepository = related.repository.toLowerCase() === reference.repository.toLowerCase();
    const target = {
      projectId: reference.projectId,
      ...(reference.host === undefined ? {} : { host: reference.host }),
      repository: related.repository,
      number: related.number,
      url: related.url,
    };
    if (sameRepository && threadRef !== null) {
      useRightPanelStore.getState().openIssue(threadRef, { environmentId, ...target });
      return;
    }
    if (sameRepository && onOpenIssue) {
      onOpenIssue(target);
      return;
    }
    void readLocalApi()?.shell.openExternal(related.url);
  };

  const openLinkedWork = () => {
    if (!issue?.linkedWork) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, issue.linkedWork.threadId)),
    });
  };

  const backButton = (focusable: boolean) =>
    onBack ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-micro"
              variant="ghost-muted"
              tabIndex={focusable ? 0 : -1}
              onClick={onBack}
              className="-ml-1.5"
              aria-label="Back to issues"
            >
              <ArrowLeftIcon aria-hidden className="size-3.5" />
            </Button>
          }
        />
        <TooltipPopup side="top">Back to issues</TooltipPopup>
      </Tooltip>
    ) : null;

  if (issue === null) {
    return detailQuery.error ? (
      <div className="relative flex h-full min-h-0 w-full flex-1 flex-col bg-background">
        {onBack ? (
          <div className="flex h-7 shrink-0 items-center pl-4">{backButton(true)}</div>
        ) : null}
        <PullRequestActivityUnavailableState
          title="Could not load this issue"
          error={formatActionError("Unable to load issue", detailQuery.error)}
          onRetry={detailQuery.refresh}
        />
      </div>
    ) : (
      <IssueDetailGhost
        number={reference.number}
        repository={reference.repository}
        onBack={onBack}
      />
    );
  }

  const permissions = issue.viewerPermissions;
  const canUpdate = permissions?.update !== false;
  const statePresentation = resolveIssueState(issue);
  const authorProfileUrl = issueActorProfileUrl(issue, issue.author);
  const cwd = issue.workspaceRoot ?? project?.workspaceRoot ?? "";
  const linkedPullRequestCount = issue.linkedPullRequests?.length ?? 0;
  const progress = issueSubIssueProgress(issue.subIssuesSummary, issue.subIssues);
  const refreshing = detailQuery.isPending;

  const numberButton = (focusable: boolean) => (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            tabIndex={focusable ? 0 : -1}
            onClick={() => void readLocalApi()?.shell.openExternal(issue.url)}
            onContextMenu={(event) => openNumberContextMenu(event, issue.url)}
            className={cn(
              "inline-flex shrink-0 cursor-pointer items-center gap-0.5 font-medium underline-offset-2 hover:underline",
              statePresentation.toneClassName,
            )}
            aria-label={`Open issue #${issue.number} on GitHub`}
          >
            #{issue.number}
            <ExternalLinkIcon aria-hidden className="size-2.5" />
          </button>
        }
      />
      <TooltipPopup side="top">{OPEN_ON_GITHUB}</TooltipPopup>
    </Tooltip>
  );

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col bg-background">
      <div className="@container/issue-header grid min-w-0 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 border-b border-border/60">
        <div className="pl-4 grid h-7 min-w-0 items-center overflow-hidden">
          <div
            aria-hidden={condensed}
            inert={condensed}
            className={cn(
              "col-start-1 row-start-1 flex min-w-0 items-center gap-1 text-sm text-muted-foreground transition-[opacity,transform] ease-out motion-reduce:transform-none motion-reduce:transition-none sm:text-xs",
              condensed
                ? "pointer-events-none -translate-y-1 opacity-0 duration-100"
                : "translate-y-0 opacity-100 delay-50 duration-150",
            )}
          >
            {backButton(!condensed)}
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => void readLocalApi()?.shell.openExternal(repositoryUrl)}
                    className="min-w-0 cursor-pointer truncate text-left font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {issue.repository}
                  </button>
                }
              />
              <TooltipPopup side="top">{`Open ${issue.repository} repository`}</TooltipPopup>
            </Tooltip>
            {numberButton(!condensed)}
          </div>
          <div
            aria-hidden={!condensed}
            inert={!condensed}
            className={cn(
              "col-start-1 row-start-1 flex min-w-0 items-center gap-1 text-sm text-muted-foreground transition-[opacity,transform] ease-out motion-reduce:transform-none motion-reduce:transition-none sm:text-xs",
              condensed
                ? "translate-y-0 opacity-100 delay-50 duration-150"
                : "pointer-events-none translate-y-1 opacity-0 duration-100",
            )}
          >
            {backButton(condensed)}
            {numberButton(condensed)}
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {issue.title}
                  </span>
                }
              />
              <TooltipPopup side="top">{issue.title}</TooltipPopup>
            </Tooltip>
          </div>
        </div>
        <div className="mr-4 flex h-7 shrink-0 items-center justify-end gap-1">
          <TooltipProvider delay={150} closeDelay={150} timeout={400}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex shrink-0">
                    <Button
                      size="xs"
                      variant="default"
                      disabled={worktreeOpen}
                      onClick={() => setWorktreeOpen(true)}
                      aria-label="Work on issue"
                    >
                      <GitBranchIcon aria-hidden className="size-3.5" />
                      <span className="@max-[30rem]/issue-header:hidden">Work on issue</span>
                    </Button>
                  </span>
                }
              />
              <TooltipPopup side="top">
                {issue.linkedWork
                  ? "Continue in a worktree for this issue"
                  : "Create a worktree and thread for this issue"}
              </TooltipPopup>
            </Tooltip>
            <Menu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <MenuTrigger
                      render={
                        <Button
                          aria-label={refreshing ? "Refreshing issue" : "More issue actions"}
                          size="icon-xs"
                          variant="ghost-muted"
                        />
                      }
                    >
                      {refreshing ? (
                        <RefreshIcon refreshing size="md" />
                      ) : (
                        <MoreHorizontalIcon className="size-4" />
                      )}
                    </MenuTrigger>
                  }
                />
                <TooltipPopup>
                  {refreshing ? "Refreshing issue" : "More issue actions"}
                </TooltipPopup>
              </Tooltip>
              <MenuPopup align="end" side="bottom">
                <MenuItem
                  disabled={refreshing}
                  onClick={() => {
                    refreshIssue();
                    commentsQuery.refresh();
                  }}
                >
                  <RefreshIcon size="sm" refreshing={refreshing} />
                  Refresh
                </MenuItem>
                {canUpdate ? (
                  <MenuItem
                    onClick={() => {
                      setTab("summary");
                      setTitleScope({ key: issueKey, text: issue.title });
                      setBodyEditingKey(issueKey);
                    }}
                  >
                    <PencilIcon className="size-3.5" />
                    Edit issue
                  </MenuItem>
                ) : null}
                <MenuSeparator />
                <MenuItem onClick={() => void readLocalApi()?.shell.openExternal(issue.url)}>
                  <ArrowUpRightIcon className="size-3.5" />
                  {OPEN_ON_GITHUB}
                </MenuItem>
                <MenuItem onClick={() => copyToClipboard(issue.url, "Issue link")}>
                  <LinkIcon className="size-3.5" />
                  Copy link
                </MenuItem>
                <MenuItem onClick={() => copyToClipboard(`#${issue.number}`, "Issue number")}>
                  <CopyIcon className="size-3.5" />
                  Copy issue number
                </MenuItem>
                {issue.state === "open" && permissions?.close !== false ? (
                  <>
                    <MenuSeparator />
                    {(["completed", "not-planned", "duplicate"] as const).map((reason) => {
                      const presentation = ISSUE_STATE_PRESENTATION[reason];
                      return (
                        <MenuItem
                          key={reason}
                          disabled={statePending}
                          onClick={() => void setIssueState(reason)}
                        >
                          <presentation.Icon className="size-3.5" />
                          {ISSUE_CLOSE_REASON_LABELS[reason]}
                        </MenuItem>
                      );
                    })}
                  </>
                ) : issue.state === "closed" && permissions?.reopen !== false ? (
                  <>
                    <MenuSeparator />
                    <MenuItem disabled={statePending} onClick={() => void setIssueState("reopen")}>
                      <ISSUE_STATE_PRESENTATION.open.Icon className="size-3.5" />
                      Reopen issue
                    </MenuItem>
                  </>
                ) : null}
              </MenuPopup>
            </Menu>
          </TooltipProvider>
        </div>

        <div
          className={cn(
            "col-span-2 grid",
            condensed
              ? "grid-rows-[1fr]"
              : "grid-rows-[0fr] transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          )}
        >
          <div
            ref={condensedRowRef}
            className={cn(
              "min-h-0 overflow-hidden transition-[opacity,transform] duration-150 ease-out motion-reduce:transform-none motion-reduce:transition-none",
              condensed
                ? "translate-y-0 opacity-100 delay-50"
                : "translate-y-1 opacity-0 duration-100",
            )}
            inert={!condensed}
          >
            <div className="col-span-2 min-w-0 px-4 pb-2 pt-1">
              <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <PullRequestActorLabel
                  actor={issue.author}
                  profileUrl={authorProfileUrl}
                  variant="avatar"
                  className="shrink-0"
                />
                <span className="shrink-0">{formatRelativeTimeLabel(issue.updatedAt)}</span>
                <span
                  className={cn(
                    "ml-auto inline-flex shrink-0 items-center gap-1 text-2xs font-medium",
                    statePresentation.toneClassName,
                  )}
                >
                  <statePresentation.Icon aria-hidden className="size-3" />
                  {statePresentation.label}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div
          className={cn(
            "col-span-2 grid",
            // Collapse before the scroll refund paints; only reopening eases back in.
            condensed
              ? "grid-rows-[0fr]"
              : "grid-rows-[1fr] transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          )}
        >
          <div
            ref={foldRef}
            className={cn(
              "min-h-0 overflow-hidden transition-[opacity,transform] duration-150 ease-out motion-reduce:transform-none motion-reduce:transition-none",
              condensed
                ? "-translate-y-1 opacity-0 duration-100"
                : "translate-y-0 opacity-100 delay-50",
            )}
            inert={condensed}
          >
            <div className="col-span-2 mt-1 min-w-0 px-4 pb-4">
              {titleDraft === null ? (
                <div className="group flex min-h-7 min-w-0 items-center gap-1 sm:min-h-6">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <h1 className="min-w-0 flex-1 truncate text-base font-semibold leading-snug">
                          {issue.title}
                        </h1>
                      }
                    />
                    <TooltipPopup side="top">{issue.title}</TooltipPopup>
                  </Tooltip>
                  {canUpdate ? (
                    <PullRequestEditButton
                      aria-label="Edit title"
                      onClick={() => setTitleScope({ key: issueKey, text: issue.title })}
                    />
                  ) : null}
                </div>
              ) : (
                // A title is one line of text, not markdown, so it takes an input.
                <div className="space-y-2">
                  <Input
                    autoFocus
                    size="sm"
                    disabled={titleSaving}
                    value={titleDraft}
                    aria-label="Issue title"
                    onChange={(event) => setTitleScope({ key: issueKey, text: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveTitle(titleDraft);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        setTitleScope(null);
                      }
                    }}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={titleSaving}
                      onClick={() => setTitleScope(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={titleSaving || titleDraft.trim().length === 0}
                      onClick={() => void saveTitle(titleDraft)}
                    >
                      {titleSaving ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </div>
              )}
              <div className="mt-2 flex min-h-5 min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <PullRequestMetaLine className="min-w-0 whitespace-nowrap">
                  <PullRequestActorLabel actor={issue.author} profileUrl={authorProfileUrl} />
                  <span>opened {formatRelativeTimeLabel(issue.createdAt)}</span>
                  <span>updated {formatRelativeTimeLabel(issue.updatedAt)}</span>
                </PullRequestMetaLine>
                <span
                  className={cn(
                    "ml-auto inline-flex shrink-0 items-center gap-1 font-medium",
                    statePresentation.toneClassName,
                  )}
                >
                  <statePresentation.Icon aria-hidden className="size-3.5" />
                  {statePresentation.label}
                </span>
              </div>
            </div>
          </div>
        </div>

        <nav
          className="col-span-2 flex min-w-0 flex-wrap items-center gap-2 border-t border-border/60 px-4 py-2"
          aria-label="Issue tabs"
        >
          <ToggleGroup
            className="shrink-0"
            size="segmented"
            variant="segmented"
            value={[tab]}
            onValueChange={(next) => {
              const nextTab = TABS.find((item) => item.value === next[0])?.value;
              if (nextTab) setTab(nextTab);
            }}
          >
            {TABS.map((item) => (
              <Toggle key={item.value} value={item.value}>
                {item.label}
              </Toggle>
            ))}
          </ToggleGroup>
          <PullRequestMetaLine className="ml-auto whitespace-nowrap text-2xs text-muted-foreground">
            <span
              className="inline-flex items-center gap-1"
              aria-label={`${issue.commentsCount.toLocaleString()} ${issue.commentsCount === 1 ? "comment" : "comments"}`}
            >
              <MessageSquareIcon aria-hidden className="size-3" />
              {issue.commentsCount.toLocaleString()}
            </span>
            {linkedPullRequestCount > 0 ? (
              <span
                className="inline-flex items-center gap-1"
                aria-label={`${linkedPullRequestCount} linked ${linkedPullRequestCount === 1 ? "pull request" : "pull requests"}`}
              >
                <PullRequestGlyph.pullRequest aria-hidden className="size-3" />
                {linkedPullRequestCount}
              </span>
            ) : null}
            {progress ? <span>{progress.label}</span> : null}
          </PullRequestMetaLine>
        </nav>
      </div>

      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
        onScrollCapture={onScrollCapture}
      >
        <PullRequestMarkdownContext value={markdownContext}>
          {mountedTabs.has("summary") ? (
            <div className={cn("absolute inset-0", tab !== "summary" && "invisible")}>
              <IssueSummaryTab
                key={issueKey}
                environmentId={environmentId}
                threadRef={threadRef}
                reference={reference}
                issue={issue}
                cwd={cwd}
                comments={commentsQuery}
                editingBody={bodyEditingKey === issueKey}
                onEditingBodyChange={(editing) => setBodyEditingKey(editing ? issueKey : null)}
                onRefresh={refreshIssue}
                onOpenRelatedIssue={openRelatedIssue}
                onOpenLinkedWork={openLinkedWork}
              />
            </div>
          ) : null}
          {mountedTabs.has("timeline") ? (
            <div className={cn("absolute inset-0", tab !== "timeline" && "invisible")}>
              <IssueTimelineTab
                key={issueKey}
                environmentId={environmentId}
                threadRef={threadRef}
                reference={reference}
                issue={issue}
                cwd={cwd}
                refreshToken={timelineToken}
                onOpenRelatedIssue={openRelatedIssue}
              />
            </div>
          ) : null}
        </PullRequestMarkdownContext>
      </div>

      {/* Floats over the content, in the pull request composer's place. */}
      <div className="absolute right-4 bottom-3 z-20">
        <IssueComposer
          key={issueKey}
          environmentId={environmentId}
          threadRef={threadRef}
          reference={reference}
          issue={issue}
          cwd={cwd}
          statePending={statePending}
          onSetState={setIssueState}
          onCommented={() => {
            commentsQuery.refresh();
            refreshIssue();
          }}
        />
      </div>

      <IssueWorktreeDialog
        open={worktreeOpen}
        onOpenChange={setWorktreeOpen}
        environmentId={environmentId}
        reference={reference}
        issueTitle={issue.title}
        linkedWork={issue.linkedWork ?? null}
        canLink={permissions?.link !== false}
        onActed={refreshIssue}
      />
    </div>
  );
}

/**
 * The panel's own shape while the issue is read: the same header chrome, tabs and summary rows,
 * so the loaded issue fills it in place rather than replacing one layout with another.
 */
function IssueDetailGhost({
  number,
  repository,
  onBack,
}: {
  number: number;
  repository: string;
  onBack?: (() => void) | undefined;
}) {
  return (
    <div
      role="status"
      aria-label="Loading issue"
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-background"
    >
      <div className="@container/issue-header grid min-w-0 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 border-b border-border/60">
        <div className="pl-4 flex h-7 min-w-0 items-center gap-1 text-sm text-muted-foreground sm:text-xs">
          {onBack ? (
            <Button
              size="icon-micro"
              variant="ghost-muted"
              className="-ml-1.5"
              onClick={onBack}
              aria-label="Back to issues"
            >
              <ArrowLeftIcon aria-hidden className="size-3.5" />
            </Button>
          ) : null}
          <span className="min-w-0 truncate font-medium">{repository}</span>
          <span className="shrink-0">#{number}</span>
        </div>
        <div className="mr-4 flex h-7 shrink-0 items-center justify-end gap-1">
          <Button size="xs" variant="default" disabled aria-label="Work on issue">
            <GitBranchIcon aria-hidden className="size-3.5" />
            <span className="@max-[30rem]/issue-header:hidden">Work on issue</span>
          </Button>
          <Button size="icon-xs" variant="ghost" disabled aria-label="Issue actions loading">
            <EllipsisIcon aria-hidden className="size-4" />
          </Button>
        </div>
        <div className="col-span-2 mt-1 min-w-0 px-4 pb-4 motion-safe:animate-skeleton">
          <div className="flex min-h-7 min-w-0 items-center sm:min-h-6">
            <GhostBar className="h-5 w-4/5 max-w-md" />
          </div>
          <div className="mt-2 flex min-h-5 min-w-0 items-center gap-2">
            <GhostBar className="size-4 rounded-full" />
            <GhostBar className="h-3 w-14" />
            <GhostBar className="h-3 w-24" />
            <GhostBar className="ml-auto h-3 w-12" />
          </div>
        </div>
        <nav
          className="col-span-2 flex min-w-0 flex-wrap items-center gap-2 border-t border-border/60 px-4 py-2"
          aria-label="Issue tabs"
          inert
        >
          <ToggleGroup
            className="shrink-0"
            size="segmented"
            variant="segmented"
            value={["summary"]}
          >
            {TABS.map((item) => (
              <Toggle key={item.value} value={item.value} tabIndex={-1}>
                {item.label}
              </Toggle>
            ))}
          </ToggleGroup>
          <GhostBar className="ml-auto h-3 w-16" />
        </nav>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden motion-safe:animate-skeleton">
        <section className="space-y-2 px-4 pt-2.5 pb-1">
          {[
            { icon: <UsersIcon aria-hidden className="size-3.5" />, label: "Assignees" },
            { icon: <TagIcon aria-hidden className="size-3.5" />, label: "Labels" },
          ].map((row) => (
            <div
              key={row.label}
              className="grid min-h-7 min-w-0 grid-cols-[6rem_minmax(0,1fr)] items-center gap-2 text-xs sm:min-h-6"
            >
              <span className="flex items-center gap-1.5 text-muted-foreground">
                {row.icon}
                {row.label}
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <GhostBar className="h-4.5 w-20" />
                <GhostBar className="h-4.5 w-16" />
              </span>
            </div>
          ))}
        </section>
        <section className="space-y-2 px-4 py-3">
          <GhostBar className="mb-3 h-3 w-20" />
          <GhostBar className="h-4 w-full" />
          <GhostBar className="h-4 w-11/12" />
          <GhostBar className="h-4 w-4/5" />
          <GhostBar className="h-4 w-2/3" />
        </section>
      </div>
    </div>
  );
}
