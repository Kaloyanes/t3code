/**
 * The floating control over an issue, in the place and shape of the pull request composer: a
 * comment written with a preview, optionally the one that closes or reopens the issue. Closing
 * keeps GitHub's three reasons behind the split button's chevron.
 */
import type {
  EnvironmentId,
  IssueCloseReason,
  IssueDetail,
  IssueRef,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { ChevronDownIcon, MessageSquareIcon, SendIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";

import { issueEnvironment } from "~/state/issues";
import { useAtomCommand } from "~/state/use-atom-command";

import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Popover, PopoverClose, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { toastManager } from "../ui/toast";
import { MarkdownWritePreview } from "../pullRequest/PullRequestMarkdownEditor";
import { ISSUE_STATE_PRESENTATION } from "./issuePresentation";

export const ISSUE_CLOSE_REASON_LABELS: Record<IssueCloseReason, string> = {
  completed: "Close as completed",
  "not-planned": "Close as not planned",
  duplicate: "Close as duplicate",
};

export function IssueComposer({
  environmentId,
  threadRef,
  reference,
  issue,
  cwd,
  statePending,
  onSetState,
  onCommented,
}: {
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef | null;
  reference: IssueRef;
  issue: IssueDetail;
  cwd: string;
  /** A close or reopen is already on its way, from here or from the panel's menu. */
  statePending: boolean;
  /** Closes with a reason, or reopens; resolves whether the host did it. */
  onSetState: (change: IssueCloseReason | "reopen") => Promise<boolean>;
  onCommented: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const commentCreate = useAtomCommand(issueEnvironment.commentCreate, { reportFailure: false });
  const permissions = issue.viewerPermissions;
  const canComment = permissions?.comment !== false;
  const stateAction =
    issue.state === "open"
      ? permissions?.close !== false
        ? ("close" as const)
        : null
      : permissions?.reopen !== false
        ? ("reopen" as const)
        : null;
  if (!canComment && stateAction === null) return null;

  const trimmed = body.trim();
  const busy = submitting || statePending;

  const postComment = async (): Promise<boolean> => {
    const result = await commentCreate({ environmentId, input: { ...reference, body: trimmed } });
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: "Could not post the comment" });
      return false;
    }
    return true;
  };

  const submit = async (change: IssueCloseReason | "reopen" | null) => {
    if (busy || (change === null && trimmed.length === 0)) return;
    setSubmitting(true);
    // The comment goes first, as it does on GitHub, so it reads above the state change it explains.
    const commented = trimmed.length > 0 ? await postComment() : true;
    if (!commented) {
      setSubmitting(false);
      return;
    }
    if (trimmed.length > 0) {
      setBody("");
      onCommented();
    }
    const changed = change === null ? true : await onSetState(change);
    setSubmitting(false);
    if (changed) setOpen(false);
  };

  const closePresentation = ISSUE_STATE_PRESENTATION.completed;
  const reopenPresentation = ISSUE_STATE_PRESENTATION.open;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button size="icon" variant="glass" />}
        aria-label={canComment ? "Comment on issue" : "Close or reopen issue"}
      >
        <MessageSquareIcon className="size-4" />
      </PopoverTrigger>
      <PopoverPopup
        keepMounted
        side="top"
        align="end"
        sideOffset={8}
        width="lg"
        initialFocus={textareaRef}
        aria-label="Issue composer"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <PopoverTitle>Comment on issue</PopoverTitle>
          <PopoverClose
            render={<Button size="icon-xs" variant="ghost" />}
            aria-label="Close composer"
          >
            <XIcon className="size-3.5" />
          </PopoverClose>
        </div>
        <div
          className="space-y-2"
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey) &&
              !event.shiftKey &&
              !event.altKey
            ) {
              event.preventDefault();
              event.stopPropagation();
              if (!event.repeat && canComment) void submit(null);
            }
          }}
        >
          {canComment ? (
            <MarkdownWritePreview
              value={body}
              onChange={setBody}
              cwd={cwd}
              environmentId={environmentId}
              threadRef={threadRef}
              placeholder="Leave a comment"
              label="Comment on this issue"
              // Locked while posting: the body clears on success, which would otherwise throw
              // away a new draft typed while the request was still in flight.
              disabled={busy}
              rows={3}
              autoFocus={false}
              textareaRef={textareaRef}
            />
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            {stateAction === "close" ? (
              <Group aria-label="Close issue">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void submit("completed")}
                >
                  <closePresentation.Icon className="size-3.5" />
                  {trimmed.length > 0 ? "Close with comment" : "Close issue"}
                </Button>
                <GroupSeparator />
                <Menu>
                  <MenuTrigger
                    disabled={busy}
                    render={
                      <Button size="icon-xs" variant="outline" aria-label="Other close reasons" />
                    }
                  >
                    <ChevronDownIcon className="size-3.5" />
                  </MenuTrigger>
                  <MenuPopup align="end" side="top">
                    {(["completed", "not-planned", "duplicate"] as const).map((reason) => {
                      const presentation = ISSUE_STATE_PRESENTATION[reason];
                      return (
                        <MenuItem key={reason} onClick={() => void submit(reason)}>
                          <presentation.Icon className="size-3.5" />
                          {ISSUE_CLOSE_REASON_LABELS[reason]}
                        </MenuItem>
                      );
                    })}
                  </MenuPopup>
                </Menu>
              </Group>
            ) : stateAction === "reopen" ? (
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() => void submit("reopen")}
              >
                <reopenPresentation.Icon className="size-3.5" />
                {trimmed.length > 0 ? "Reopen with comment" : "Reopen issue"}
              </Button>
            ) : null}
            {canComment ? (
              <Button
                size="xs"
                variant="outline"
                disabled={trimmed.length === 0 || busy}
                onClick={() => void submit(null)}
              >
                <SendIcon className="size-3.5" />
                {submitting ? "Posting..." : "Comment"}
              </Button>
            ) : null}
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
