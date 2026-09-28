import type {
  EnvironmentId,
  VcsStatusResult,
  IssueWorktreeDeleteSelection,
  IssueWorktreeDeleteDecision,
  IssueWorktreeDeletePreflightItem,
} from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { issueEnvironment } from "../state/issues";
import { WorktreeIssueDecisions } from "./issue/WorktreeIssueDecisions";

import { useAtomCommand } from "../state/use-atom-command";
import { vcsEnvironment } from "../state/vcs";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";

export function worktreeDeletionPreflightReason(
  status: VcsStatusResult | null,
  error: string | null,
) {
  if (error) return `Could not check this worktree: ${error}`;
  if (!status) return "Checking this worktree for local changes…";
  if (!status.isRepo && status.pathExists !== false)
    return "This path is no longer a Git worktree.";
  if (status.hasWorkingTreeChanges) return "Commit or discard local changes before deleting.";
  return null;
}

function WorktreeDeleteDialogContent(props: {
  environmentId: EnvironmentId;
  path: string;
  label: string;
  threadCount: number;
  onClose: () => void;
  issueSelection?: IssueWorktreeDeleteSelection;
  onConfirm: (decisions: IssueWorktreeDeleteDecision[]) => void;
}) {
  const preflight = useAtomCommand(issueEnvironment.worktreeDeletePreflight, {
    reportFailure: false,
  });
  const [issueCheck, setIssueCheck] = useState<IssueWorktreeDeletePreflightItem | null>(null);
  const [decisions, setDecisions] = useState<IssueWorktreeDeleteDecision[]>([]);
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const [status, setStatus] = useState<VcsStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const issueThreadId = props.issueSelection?.threadId;
  const issueProjectId = props.issueSelection?.projectId;
  useEffect(() => {
    let active = true;
    if (issueThreadId && issueProjectId) {
      void preflight({
        environmentId: props.environmentId,
        input: {
          selections: [{ threadId: issueThreadId, projectId: issueProjectId, path: props.path }],
        },
      }).then((result) => {
        if (!active) return;
        if (result._tag === "Success" && result.value.items[0])
          setIssueCheck(result.value.items[0]);
        else setError("Unable to check linked issues and threads.");
      });
    }
    void refreshStatus({ environmentId: props.environmentId, input: { cwd: props.path } }).then(
      (result) => {
        if (!active) return;
        if (result._tag === "Success") setStatus(result.value);
        else setError("Unable to check Git status.");
      },
    );
    return () => {
      active = false;
    };
  }, [props.environmentId, props.path, issueThreadId, issueProjectId, preflight, refreshStatus]);
  const reason =
    worktreeDeletionPreflightReason(status, error) ??
    (props.issueSelection && !issueCheck ? "Checking linked issues and threads…" : null) ??
    (issueCheck?.blocked ? (issueCheck.reason ?? "Worktree deletion is blocked.") : null);

  return (
    <AlertDialog open onOpenChange={(open) => !open && props.onClose()}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete worktree "{props.label}"?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="block break-all">{props.path}</span>
            {props.threadCount > 0 ? (
              <span className="mt-2 block">
                {props.threadCount} linked {props.threadCount === 1 ? "thread" : "threads"} will
                {props.issueSelection
                  ? " keep their history. Issue-linked threads will be detached and read-only."
                  : " keep their history and move to the current checkout."}
              </span>
            ) : null}
            <span className="mt-2 block">The branch will remain available.</span>
            {status?.hasUpstream && status.aheadCount > 0 ? (
              <span className="mt-2 block">
                {status.aheadCount} unpushed {status.aheadCount === 1 ? "commit" : "commits"} will
                remain on the branch.
              </span>
            ) : null}
            {reason ? <span className="mt-2 block">{reason}</span> : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {issueCheck ? (
          <WorktreeIssueDecisions
            issues={issueCheck.issues ?? []}
            decisions={decisions}
            onChange={setDecisions}
          />
        ) : null}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button
            variant="destructive"
            disabled={reason !== null}
            onClick={() => props.onConfirm(decisions)}
          >
            Delete worktree
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

export function WorktreeDeleteDialog(props: Parameters<typeof WorktreeDeleteDialogContent>[0]) {
  return (
    <WorktreeDeleteDialogContent
      key={`${props.environmentId}:${props.path}:${props.issueSelection?.threadId ?? ""}`}
      {...props}
    />
  );
}
