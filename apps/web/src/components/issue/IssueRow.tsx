import type { ContextMenuItem } from "@t3tools/contracts";
import { GitBranchIcon, MessageSquareIcon, MilestoneIcon } from "lucide-react";
import { memo, type MouseEvent } from "react";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { readLocalApi } from "~/localApi";
import { cn } from "~/lib/utils";

import {
  PULL_REQUEST_ROW_CLASS,
  PULL_REQUEST_ROW_NUMBER_CLASS,
  PullRequestRowAuthor,
  PullRequestRowLines,
} from "../pullRequest/PullRequestListRow";
import { PullRequestRowLabels } from "../pullRequest/PullRequestRow";
import { PullRequestActorAvatar } from "../pullRequest/pullRequestPresentation";
import {
  openOnHostLabel,
  showPullRequestLinkContextMenu,
} from "../pullRequest/pullRequestLinkContextMenu";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { issueListEntryKey, type EnvironmentIssueEntry } from "./issue.logic";
import { IssueStateGlyph } from "./IssueStateGlyph";

/** Assignees past this many collapse into the tooltip; the stack stays one glance wide. */
const MAX_ASSIGNEE_AVATARS = 3;

function IssueAssignees({
  assignees,
}: {
  assignees: NonNullable<EnvironmentIssueEntry["assignees"]>;
}) {
  if (assignees.length === 0) return null;
  const logins = assignees.map((assignee) => assignee.login).join(", ");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="flex shrink-0 items-center -space-x-1"
            aria-label={`Assigned to ${logins}`}
          />
        }
      >
        {assignees.slice(0, MAX_ASSIGNEE_AVATARS).map((assignee) => (
          <PullRequestActorAvatar
            key={assignee.login}
            actor={assignee}
            className="size-3.5 ring-1 ring-background"
          />
        ))}
        {assignees.length > MAX_ASSIGNEE_AVATARS ? (
          <span className="pl-1.5 tabular-nums text-muted-foreground">
            +{assignees.length - MAX_ASSIGNEE_AVATARS}
          </span>
        ) : null}
      </TooltipTrigger>
      <TooltipPopup side="top">Assigned to {logins}</TooltipPopup>
    </Tooltip>
  );
}

type IssueRowMenuAction = "work" | "open-thread" | "open-external" | "copy-link";

export interface IssueRowProps {
  entry: EnvironmentIssueEntry;
  /** Open in the right panel. */
  selected: boolean;
  /** Part of the bulk selection. */
  checked: boolean;
  /** Any row is checked, so every checkbox shows rather than only the hovered one. */
  selectionActive: boolean;
  /** Only when the list spans more than one repository, where the number alone is ambiguous. */
  showRepository: boolean;
  onOpen: (entry: EnvironmentIssueEntry) => void;
  /** `range` extends from the last toggled row, as a shift-click does. */
  onToggleSelect: (entry: EnvironmentIssueEntry, range: boolean) => void;
  onWorkOn: (entry: EnvironmentIssueEntry) => void;
  onOpenThread: (entry: EnvironmentIssueEntry) => void;
}

function IssueRowImpl({
  entry,
  selected,
  checked,
  selectionActive,
  showRepository,
  onOpen,
  onToggleSelect,
  onWorkOn,
  onOpenThread,
}: IssueRowProps) {
  const linkedWork = entry.linkedWork ?? null;
  const showRowMenu = async (event: MouseEvent) => {
    const api = readLocalApi();
    if (!api) return;
    event.preventDefault();
    const items: ContextMenuItem<IssueRowMenuAction>[] = [
      { id: "work", label: "Work on issue", icon: "git-branch" },
      ...(linkedWork ? [{ id: "open-thread" as const, label: "Open linked thread" }] : []),
      { id: "open-external", label: openOnHostLabel(entry.provider), separatorBefore: true },
      { id: "copy-link", label: "Copy link", icon: "copy" },
    ];
    const action = await api.contextMenu
      .show(items, { x: event.clientX, y: event.clientY })
      .catch(() => null);
    try {
      if (action === "work") onWorkOn(entry);
      else if (action === "open-thread") onOpenThread(entry);
      else if (action === "open-external") await api.shell.openExternal(entry.url);
      else if (action === "copy-link") await writeTextToClipboard(entry.url, "issue link");
    } catch {
      toastManager.add({
        type: "error",
        title: action === "copy-link" ? "Could not copy the link" : "Could not open the link",
      });
    }
  };
  return (
    <div
      onContextMenu={(event) => void showRowMenu(event)}
      className={cn(
        PULL_REQUEST_ROW_CLASS,
        "group/issue-row relative px-3 py-2.5 transition-colors has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-ring",
        // Offscreen rows skip style, layout and paint, as the pull request rows do; the
        // intrinsic size is the two lines without padding, so the scrollbar stays honest.
        "[contain-intrinsic-block-size:36.5px] [content-visibility:auto]",
        selected ? "bg-accent" : checked ? "bg-accent/50" : "hover:bg-accent/60",
      )}
    >
      <span
        className={cn(
          "mt-0.25 flex shrink-0 self-start transition-opacity",
          !selectionActive &&
            !checked &&
            "opacity-0 focus-within:opacity-100 group-hover/issue-row:opacity-100",
        )}
      >
        <Checkbox
          checked={checked}
          aria-label={`Select issue #${entry.number}`}
          onClick={(event) => {
            event.preventDefault();
            onToggleSelect(entry, event.shiftKey);
          }}
        />
      </span>
      <button
        type="button"
        // The work item lists' j/k cursor walks these; Enter opens like a click.
        data-work-item-row={issueListEntryKey(entry)}
        aria-current={selected ? "true" : undefined}
        onClick={(event) => {
          if (event.shiftKey || event.metaKey || event.ctrlKey) {
            onToggleSelect(entry, event.shiftKey);
            return;
          }
          onOpen(entry);
        }}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left focus-visible:outline-none"
      >
        {/* On the title line rather than between the lines, as the pull request rows align it. */}
        <span className="mt-0.75 flex shrink-0 self-start">
          <IssueStateGlyph state={entry.state} stateReason={entry.stateReason} />
        </span>
        <PullRequestRowLines
          number={
            // A right-click on the number copies the issue's own address, as on pull requests.
            <span
              className={PULL_REQUEST_ROW_NUMBER_CLASS}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void showPullRequestLinkContextMenu({
                  url: entry.url,
                  openLabel: openOnHostLabel(entry.provider),
                  position: { x: event.clientX, y: event.clientY },
                });
              }}
            >
              #{entry.number}
            </span>
          }
          title={entry.title}
          status={
            <>
              {entry.commentsCount > 0 ? (
                <span
                  className="flex items-center gap-0.5 tabular-nums text-muted-foreground"
                  aria-label={`${entry.commentsCount} comments`}
                >
                  <MessageSquareIcon aria-hidden className="size-3" />
                  {entry.commentsCount}
                </span>
              ) : null}
              <IssueAssignees assignees={entry.assignees ?? []} />
            </>
          }
          metaClassName="@container/pr-row-meta"
          meta={
            <>
              <PullRequestRowAuthor
                actor={entry.author}
                className="min-w-3.5 max-w-40"
                labelClassName="sr-only @xs/pr-row-meta:not-sr-only @xs/pr-row-meta:truncate"
              />
              {showRepository ? <span className="truncate">{entry.repository}</span> : null}
              {entry.labels.length > 0 ? <PullRequestRowLabels labels={entry.labels} /> : null}
              {entry.milestone ? (
                <span className="flex min-w-0 max-w-32 items-center gap-0.5">
                  <MilestoneIcon aria-hidden className="size-3 shrink-0" />
                  <span className="truncate">{entry.milestone.title}</span>
                </span>
              ) : null}
              {linkedWork ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      // A span, not a button: the row is the button. The context menu offers
                      // the same jump for keyboard readers.
                      <span
                        className="flex shrink-0 items-center gap-0.5 text-info-foreground hover:underline"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenThread(entry);
                        }}
                      />
                    }
                  >
                    <GitBranchIcon aria-hidden className="size-3" />
                    In progress
                  </TooltipTrigger>
                  <TooltipPopup side="top">
                    {linkedWork.branch ? `Working on ${linkedWork.branch}` : "Linked to a thread"}
                    {" · open the thread"}
                  </TooltipPopup>
                </Tooltip>
              ) : null}
            </>
          }
          updatedAt={entry.updatedAt}
        />
      </button>
      {/* Over the row's right end on hover, on the row's own hover fill, so the counts it
          covers are back the moment the pointer leaves. */}
      <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded-md bg-accent opacity-0 transition-opacity group-hover/issue-row:pointer-events-auto group-hover/issue-row:opacity-100 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Work on issue #${entry.number}`}
                onClick={() => onWorkOn(entry)}
              />
            }
          >
            <GitBranchIcon aria-hidden className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">Work on issue</TooltipPopup>
        </Tooltip>
      </span>
    </div>
  );
}

/**
 * Memoized for the same reason the pull request rows are: a search keystroke or a poll re-renders
 * the list, and a row whose entry and flags are unchanged has nothing new to draw. The route hands
 * it stable callbacks.
 */
export const IssueRow = memo(IssueRowImpl);
