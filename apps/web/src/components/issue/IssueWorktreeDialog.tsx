import type {
  EnvironmentId,
  IssueLinkedWork,
  IssueRef,
  IssueWorktreeDeleteDecision,
  IssueWorktreeDeletePreflightResult,
  IssueWorktreeDeleteResult,
  IssueWorktreePrepareResult,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useAtomValue } from "@effect/atom-react";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import * as Cause from "effect/Cause";
import {
  CheckIcon,
  GitBranchIcon,
  LinkIcon,
  RefreshCwIcon,
  SearchIcon,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { resolveDefaultProviderModelSelection } from "~/providerInstances";
import { newThreadId } from "~/lib/utils";
import { issueEnvironment } from "~/state/issues";
import { useAtomCommand } from "~/state/use-atom-command";
import { useProject, useThreadShells } from "~/state/entities";
import { usePaginatedBranches } from "~/state/queries";
import { threadEnvironment } from "~/state/threads";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { serverEnvironment } from "~/state/server";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { resolveExistingWorktreeOptions } from "../BranchToolbar.logic";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
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
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Spinner } from "../ui/spinner";
import { ActionFeedback, useScopedActions } from "./issueActions";
import { issueWorktreeIsLinked, issueWorktreePrimaryAction } from "./issue.logic";
import { WorktreeIssueDecisions } from "./WorktreeIssueDecisions";

export interface IssueWorktreeDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly reference: IssueRef;
  readonly linkedWork: IssueLinkedWork | null;
  readonly issueTitle: string;
  readonly canLink?: boolean;
  readonly onActed?: () => void;
}

export function IssueWorktreeDialog(props: IssueWorktreeDialogProps) {
  const { environmentId, reference } = props;
  return (
    <IssueWorktreeDialogContent
      key={JSON.stringify([
        environmentId,
        reference.projectId,
        reference.host,
        reference.repository,
        reference.number,
      ])}
      {...props}
    />
  );
}

function IssueWorktreeDialogContent({
  open,
  onOpenChange,
  environmentId,
  reference,
  linkedWork,
  issueTitle,
  canLink = true,
  onActed,
}: IssueWorktreeDialogProps) {
  const threads = useThreadShells();
  const project = useProject(scopeProjectRef(environmentId, reference.projectId));
  const branches = usePaginatedBranches({
    environmentId: open ? environmentId : null,
    cwd: open ? (project?.workspaceRoot ?? null) : null,
  });
  const { refs, loadNext, isPending, error, data } = branches;
  useEffect(() => {
    if (open && !isPending && !error && data?.nextCursor != null) loadNext();
  }, [open, isPending, error, data?.nextCursor, loadNext]);
  const settings = useEnvironmentSettings(environmentId);
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const defaults = resolveProjectSettings(settings, reference.projectId, project).settings;
  const modelSelection = resolveDefaultProviderModelSelection(
    providers ?? [],
    defaults.defaultModelSelection,
  );
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const prepare = useAtomCommand(issueEnvironment.worktreePrepare, { reportFailure: false });
  const preflight = useAtomCommand(issueEnvironment.worktreeDeletePreflight, {
    reportFailure: false,
  });
  const remove = useAtomCommand(issueEnvironment.worktreeDelete, { reportFailure: false });
  const replace = useAtomCommand(issueEnvironment.worktreeReplace, { reportFailure: false });
  const link = useAtomCommand(issueEnvironment.link, { reportFailure: false });
  const newThread = useNewThreadHandler();
  const actions = useScopedActions();
  const [name, setName] = useState(issueTitle.trim().slice(0, 128) || "issue");
  const [baseBranch, setBaseBranch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preflightResult, setPreflightResult] = useState<IssueWorktreeDeletePreflightResult | null>(
    null,
  );
  const [issueDecisions, setIssueDecisions] = useState<IssueWorktreeDeleteDecision[]>([]);
  const [deleteResult, setDeleteResult] = useState<IssueWorktreeDeleteResult | null>(null);
  const [forceAcknowledged, setForceAcknowledged] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [worktreeQuery, setWorktreeQuery] = useState("");
  const [linkingThreadId, setLinkingThreadId] = useState<string | null>(null);
  const worktrees = useMemo(
    () =>
      project
        ? resolveExistingWorktreeOptions({
            refs,
            workspaceRoot: project.workspaceRoot,
            repositoryRoot: project.repositoryIdentity?.rootPath ?? null,
          }).map((option) => {
            const thread = threads.find(
              (item) =>
                item.environmentId === environmentId &&
                item.projectId === reference.projectId &&
                item.worktreePath !== null &&
                normalizeProjectPathForComparison(item.worktreePath) ===
                  normalizeProjectPathForComparison(option.worktreePath),
            );
            return {
              ...option,
              id: option.worktreePath,
              projectId: reference.projectId,
              title: option.label,
              threadId:
                thread?.id ??
                project.worktreeIssues?.find(
                  (issue) =>
                    issue.worktreePath !== null &&
                    normalizeProjectPathForComparison(issue.worktreePath) ===
                      normalizeProjectPathForComparison(option.worktreePath),
                )?.threadId ??
                null,
            };
          })
        : [],
    [environmentId, project, reference.projectId, refs, threads],
  );
  const selectedItems = worktrees.filter(
    (worktree) => selected.has(worktree.id) && worktree.threadId !== null,
  );
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
    threadId: thread.threadId!,
    projectId: thread.projectId,
    path: thread.worktreePath!,
  }));
  const createPending = actions.hasPending("create");
  const replacePending = actions.hasPending("replace");
  const preflightPending = actions.hasPending("preflight");
  const deletePending = actions.hasPending("delete");
  const linkPending = actions.hasPending("link");
  const openWorktreePending = actions.hasPending("open-worktree");
  const worktreePrimaryAction = issueWorktreePrimaryAction({
    canLink,
    hasLinkedWork: linkedWork !== null,
  });

  const createWorktreeThread = async (worktree: { branch: string; worktreePath: string }) => {
    const threadId = newThreadId();
    if (!modelSelection) throw new Error("Enable a provider to link an issue to a new thread");
    const result = await createThread({
      environmentId,
      input: {
        threadId,
        projectId: reference.projectId,
        title: `Issue #${reference.number}`,
        modelSelection,
        runtimeMode: defaults.defaultRuntimeMode,
        interactionMode: "default",
        ...worktree,
      },
    });
    if (result._tag === "Failure") throw Cause.squash(result.cause);
    return threadId;
  };

  const prepareWorktree = () => {
    const trimmedName = name.trim();
    if (trimmedName.length === 0 || createPending) return;
    setNotice(null);
    void actions.run(
      "create",
      "Unable to create worktree",
      async () => {
        if (canLink && !modelSelection)
          throw new Error("Enable a provider to link an issue to a new thread");
        const result = await prepare({
          environmentId,
          input: {
            ...reference,
            name: trimmedName,
            ...(baseBranch.trim() ? { baseBranch: baseBranch.trim() } : {}),
          },
        });
        if (result._tag === "Failure") return result;
        branches.refresh();
        if (!canLink) return result;
        const { worktree } = result.value as IssueWorktreePrepareResult;
        const threadId = await createWorktreeThread({
          branch: worktree.branch,
          worktreePath: worktree.worktreePath,
        });
        return link({ environmentId, input: { ...reference, threadId, source: "created" } });
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
        setIssueDecisions([]);
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
            selections: preflightResult.items.map(({ threadId, projectId, path }) => ({
              threadId,
              projectId,
              path,
            })),
            forceAcknowledged,
            issueDecisions,
          },
        }),
      (value) => {
        setDeleteResult(value as IssueWorktreeDeleteResult);
        branches.refresh();
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
        branches.refresh();
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

  const linkWorktree = (target: (typeof worktrees)[number]) => {
    if (linkedWork !== null || !canLink || linkPending) return;
    setNotice(null);
    setLinkingThreadId(target.id);
    void actions
      .run(
        "link",
        "Unable to link issue to worktree",
        async () => {
          const threadId =
            target.threadId ??
            (await createWorktreeThread({
              branch: target.branch,
              worktreePath: target.worktreePath,
            }));
          return link({
            environmentId,
            input: {
              ...reference,
              threadId,
              source: "manual",
            },
          });
        },
        () => {
          setNotice("Issue linked to this worktree.");
          onActed?.();
        },
      )
      .finally(() => setLinkingThreadId(null));
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
        <DialogPanel>
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
          <ActionFeedback pending={isPending} pendingLabel="Loading worktrees…" error={error} />
          {worktrees.length > 0 ? (
            <section className="space-y-2">
              <div>
                <h3 className="text-sm font-semibold">
                  Existing worktrees{" "}
                  <span className="text-muted-foreground">({worktrees.length})</span>
                </h3>
                <p className="text-xs text-muted-foreground">
                  {worktreePrimaryAction === "link-issue"
                    ? "Link this issue to an existing worktree, or select worktrees to check before deleting."
                    : "Start a new thread in a worktree, or select worktrees to check before deleting."}
                </p>
              </div>
              {worktrees.length > 8 ? (
                <InputGroup>
                  <InputGroupAddon>
                    <SearchIcon aria-hidden />
                  </InputGroupAddon>
                  <InputGroupInput
                    value={worktreeQuery}
                    onChange={(event) => setWorktreeQuery(event.target.value)}
                    placeholder="Search worktrees"
                    aria-label="Search worktrees"
                  />
                </InputGroup>
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
                        onCheckedChange={(checked) => {
                          setPreflightResult(null);
                          setIssueDecisions([]);
                          setSelected((current) => {
                            const next = new Set(current);
                            if (checked === true) next.add(thread.id);
                            else next.delete(thread.id);
                            return next;
                          });
                        }}
                        aria-label={`Select ${thread.title}`}
                        disabled={deletePending || preflightPending || thread.threadId === null}
                      />
                      <label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer">
                        <span className="block truncate">{thread.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {thread.worktreePath}
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
                        aria-label={
                          worktreePrimaryAction === "link-issue"
                            ? `Link issue #${reference.number} to ${thread.branch ?? thread.title}`
                            : `New thread in ${thread.branch ?? thread.title}`
                        }
                        onClick={() =>
                          worktreePrimaryAction === "link-issue"
                            ? linkWorktree(thread)
                            : openWorktree(thread)
                        }
                        disabled={linkPending || openWorktreePending}
                        aria-busy={linkingThreadId === thread.id}
                      >
                        {linkingThreadId === thread.id ? (
                          <>
                            <Spinner className="size-3.5" aria-label="Linking issue" /> Linking…
                          </>
                        ) : worktreePrimaryAction === "link-issue" ? (
                          <>
                            <LinkIcon /> Link issue
                          </>
                        ) : (
                          <>
                            <SquarePenIcon /> New thread
                          </>
                        )}
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
                pending={linkPending}
                pendingLabel="Linking issue to worktree…"
                error={actions.errorFor("link")}
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
              <WorktreeIssueDecisions
                issues={preflightResult.items.flatMap((item) => item.issues ?? [])}
                decisions={issueDecisions}
                onChange={setIssueDecisions}
                disabled={deletePending}
              />
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
                  preflightResult.items.some((item) => item.blocked) ||
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
            <section className="rounded-lg border border-success/32 bg-success/4 p-3 text-sm">
              <p className="font-medium">Deletion results</p>
              {deleteResult.results.map((item) => (
                <p
                  key={`${item.threadId}:${item.path}`}
                  className={item.deleted ? "text-success-foreground" : "text-destructive"}
                >
                  {item.deleted ? "Deleted" : "Not deleted"} {item.path}
                  {item.error ? ` · ${item.error}` : ""}
                  {item.warnings?.map((warning) => (
                    <span key={warning} className="block">
                      {warning}
                    </span>
                  ))}
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
