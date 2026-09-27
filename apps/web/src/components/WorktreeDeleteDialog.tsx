import type { EnvironmentId, VcsStatusResult } from "@t3tools/contracts";
import { useEffect, useState } from "react";

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

export function WorktreeDeleteDialog(props: {
  environmentId: EnvironmentId;
  path: string;
  label: string;
  threadCount: number;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const [status, setStatus] = useState<VcsStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
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
  }, [props.environmentId, props.path, refreshStatus]);
  const reason = worktreeDeletionPreflightReason(status, error);

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
                keep their history and move to the current checkout.
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
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button variant="destructive" disabled={reason !== null} onClick={props.onConfirm}>
            Delete worktree
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
