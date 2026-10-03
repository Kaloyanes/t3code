import type {
  EnvironmentId,
  IssueRef,
  IssueRepositorySelection,
  ProjectId,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { CircleDotIcon, ExternalLinkIcon, GitBranchIcon, TagIcon, UsersIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { readLocalApi } from "../../localApi";
import { useProject } from "../../state/entities";
import { refreshEnvironmentShell } from "../../state/shell";
import {
  issueEnvironment,
  readIssueDraft,
  useIssueCandidates,
  useIssueTemplates,
  writeIssueDraft,
} from "../../state/issues";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
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
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { MetaRow } from "../workItem/WorkItemSummaryParts";
import { MarkdownWritePreview } from "../pullRequest/PullRequestMarkdownEditor";
import {
  PullRequestActorLabel,
  PullRequestLabelChip,
} from "../pullRequest/pullRequestPresentation";
import { issueRepositoryUrl } from "./issue.logic";
import { issueCandidatesInput, toggleIssueName } from "./issueDetail.logic";
import { IssueAssigneePicker, IssueLabelPicker } from "./IssuePickers";
import { IssueWorktreeDialog } from "./IssueWorktreeDialog";

const BLANK_ISSUE_TEMPLATE = "__blank__";

interface IssueCreateDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly selection: IssueRepositorySelection | null;
  readonly environmentId: EnvironmentId | null;
  readonly onCreated: (issue: {
    readonly projectId: ProjectId;
    readonly host: string;
    readonly repository: string;
    readonly number: number;
    readonly url: string;
  }) => void;
}

/** The issue just created with "Create & start work", waiting for its worktree to be chosen. */
interface StartWorkTarget {
  readonly environmentId: EnvironmentId;
  readonly reference: IssueRef;
  readonly title: string;
  readonly canLink: boolean;
}

export function IssueCreateDialog({
  open,
  onOpenChange,
  selection,
  environmentId,
  onCreated,
}: IssueCreateDialogProps) {
  const active = open && selection !== null && environmentId !== null;
  const templatesQuery = useIssueTemplates(active ? { environmentId, input: selection } : null);
  const project = useProject(
    selection && environmentId ? scopeProjectRef(environmentId, selection.projectId) : null,
  );
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [labels, setLabels] = useState<ReadonlyArray<string>>([]);
  const [assignees, setAssignees] = useState<ReadonlyArray<string>>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"create" | "start" | null>(null);
  const [startWork, setStartWork] = useState<StartWorkTarget | null>(null);
  // The same reads the pickers make, so chips carry their label colors and faces.
  const labelCandidatesQuery = useIssueCandidates(
    active ? { environmentId, input: issueCandidatesInput(selection, "labels") } : null,
  );
  const assigneeCandidatesQuery = useIssueCandidates(
    active ? { environmentId, input: issueCandidatesInput(selection, "assignees") } : null,
  );
  const create = useAtomCommand(issueEnvironment.create, { reportFailure: false });
  useEffect(() => {
    if (!open || !selection) return;
    const draft = readIssueDraft(
      typeof window === "undefined" ? undefined : window.localStorage,
      selection,
    );
    setTemplateId(draft?.templateId ?? "");
    setTitle(draft?.title ?? "");
    setBody(draft?.body ?? "");
    setLabels(draft?.labels ?? []);
    setAssignees(draft?.assignees ?? []);
    setError(null);
    setSubmitting(null);
  }, [open, selection]);
  useEffect(() => {
    if (!open || !selection) return;
    const timer = window.setTimeout(
      () =>
        writeIssueDraft(
          typeof window === "undefined" ? undefined : window.localStorage,
          selection,
          { ...(templateId ? { templateId } : {}), title, body, labels, assignees },
        ),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [assignees, body, labels, open, selection, templateId, title]);
  const selectedTemplate =
    templatesQuery.data?.templates.find((template) => template.id === templateId) ?? null;
  const isForm = selectedTemplate?.kind === "issue-form";
  const isSubmitting = submitting !== null;
  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const template = templatesQuery.data?.templates.find((entry) => entry.id === id);
    setTitle(template?.title ?? "");
    setBody(template?.body ?? "");
    setLabels(template?.labels ?? []);
    setAssignees(template?.assignees ?? []);
  };
  const canSubmit =
    !isSubmitting &&
    !isForm &&
    selection !== null &&
    environmentId !== null &&
    title.trim().length > 0;
  const submit = async (mode: "create" | "start") => {
    if (!canSubmit || !selection || environmentId === null) return;
    setSubmitting(mode);
    setError(null);
    try {
      const confirmed =
        (await readLocalApi()?.dialogs.confirm("Create this issue on GitHub?")) ?? true;
      if (!confirmed) return;
      const result = await create({
        environmentId,
        input: {
          ...selection,
          title: title.trim(),
          body,
          ...(templateId ? { templateId } : {}),
          ...(labels.length > 0 ? { labels } : {}),
          ...(assignees.length > 0 ? { assignees } : {}),
        },
      });
      if (result._tag === "Success") {
        const issue = result.value.issue;
        if (mode === "start") {
          setStartWork({
            environmentId,
            reference: {
              projectId: issue.projectId,
              host: issue.host,
              repository: issue.repository,
              number: issue.number,
            },
            title: issue.title,
            canLink: issue.viewerPermissions?.link !== false,
          });
        }
        onCreated({
          projectId: issue.projectId,
          host: issue.host,
          repository: issue.repository,
          number: issue.number,
          url: issue.url,
        });
        return;
      }
      setError("Could not create the issue. Your draft is still saved; try again.");
    } catch {
      setError("Could not create the issue. Your draft is still saved; try again.");
    } finally {
      setSubmitting(null);
    }
  };
  const openExternalForm = () => {
    if (!selection || isSubmitting) return;
    void readLocalApi()?.shell.openExternal(`${issueRepositoryUrl(selection)}/issues/new`);
  };
  const labelColors = new Map(
    labelCandidatesQuery.data?._tag === "labels"
      ? labelCandidatesQuery.data.candidates.map(
          (candidate) => [candidate.name.toLowerCase(), candidate.color] as const,
        )
      : [],
  );
  const assigneeActors = new Map(
    assigneeCandidatesQuery.data?._tag === "assignees"
      ? assigneeCandidatesQuery.data.candidates.map(
          (candidate) => [candidate.login.toLowerCase(), candidate] as const,
        )
      : [],
  );
  const fieldsDisabled = isSubmitting || isForm;

  return (
    <>
      <Dialog open={open} onOpenChange={isSubmitting ? undefined : onOpenChange}>
        <DialogPopup className="max-w-2xl" showCloseButton={!isSubmitting}>
          <DialogHeader>
            <DialogTitle>
              <span className="flex items-center gap-2">
                <CircleDotIcon className="size-4" />
                New issue
              </span>
            </DialogTitle>
            <DialogDescription>
              Create an issue in {selection?.repository ?? "the selected repository"}.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {templatesQuery.isPending ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner aria-label="Loading issue templates" /> Checking available templates…
              </div>
            ) : null}
            {templatesQuery.error ? (
              <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/25 bg-destructive/6 p-3 text-sm">
                <span className="text-destructive">
                  Templates could not be loaded. You can still create a blank issue.
                </span>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={templatesQuery.refresh}
                  disabled={templatesQuery.isPending}
                >
                  Retry
                </Button>
              </div>
            ) : null}
            <div className="space-y-1">
              <label className="text-sm font-medium" id="issue-template-label">
                Template
              </label>
              <Select
                value={templateId || BLANK_ISSUE_TEMPLATE}
                onValueChange={(value) =>
                  applyTemplate(value === BLANK_ISSUE_TEMPLATE || value === null ? "" : value)
                }
              >
                <SelectTrigger
                  aria-labelledby="issue-template-label"
                  disabled={templatesQuery.isPending || isSubmitting}
                >
                  <SelectValue>
                    {selectedTemplate
                      ? `${selectedTemplate.name}${isForm ? " · structured form" : ""}`
                      : "Blank issue"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  <SelectItem value={BLANK_ISSUE_TEMPLATE}>Blank issue</SelectItem>
                  {templatesQuery.data?.templates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                      {template.kind === "issue-form" ? " · structured form" : ""}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            {isForm ? (
              <div className="rounded-lg border border-warning/30 bg-warning-surface/35 p-3 text-sm">
                <p className="font-medium">This template is a structured GitHub form.</p>
                <p className="mt-1 text-muted-foreground">
                  T3 Code keeps the form fields on GitHub so validation and dropdowns work
                  correctly.
                </p>
                <div className="mt-3">
                  <Button size="sm" variant="outline" onClick={openExternalForm}>
                    Open form on GitHub <ExternalLinkIcon />
                  </Button>
                </div>
              </div>
            ) : null}
            <label className="block space-y-1 text-sm font-medium">
              <span>Title</span>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="What needs attention?"
                autoFocus
                disabled={fieldsDisabled}
              />
            </label>
            {environmentId ? (
              <div className="space-y-2">
                <span className="block text-sm font-medium">Description</span>
                <MarkdownWritePreview
                  value={body}
                  onChange={setBody}
                  cwd={project?.workspaceRoot ?? ""}
                  environmentId={environmentId}
                  placeholder="Describe the problem or idea"
                  label="Issue description"
                  disabled={fieldsDisabled}
                  rows={10}
                  autoFocus={false}
                />
              </div>
            ) : null}
            {selection && environmentId ? (
              <div className="space-y-1">
                <MetaRow icon={<UsersIcon className="size-3.5" />} label="Assignees">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    {assignees.length === 0 ? (
                      <span className="text-muted-foreground">None</span>
                    ) : (
                      assignees.map((login) => (
                        <PullRequestActorLabel
                          key={login}
                          actor={
                            assigneeActors.get(login.toLowerCase()) ?? {
                              login,
                              name: null,
                              avatarUrl: null,
                            }
                          }
                        />
                      ))
                    )}
                    <IssueAssigneePicker
                      environmentId={environmentId}
                      selection={selection}
                      selected={assignees}
                      allowed={!fieldsDisabled}
                      onToggle={(login, applied) =>
                        setAssignees((current) => toggleIssueName(current, login, applied))
                      }
                    />
                  </span>
                </MetaRow>
                <MetaRow icon={<TagIcon className="size-3.5" />} label="Labels">
                  <span className="flex min-w-0 flex-wrap items-center gap-1">
                    {labels.length === 0 ? (
                      <span className="text-muted-foreground">None</span>
                    ) : (
                      labels.map((name) => (
                        <PullRequestLabelChip
                          key={name}
                          label={{ name, color: labelColors.get(name.toLowerCase()) ?? null }}
                          size="default"
                          className="max-w-48"
                        />
                      ))
                    )}
                    <IssueLabelPicker
                      environmentId={environmentId}
                      selection={selection}
                      selected={labels}
                      allowed={!fieldsDisabled}
                      onToggle={(name, applied) =>
                        setLabels((current) => toggleIssueName(current, name, applied))
                      }
                    />
                  </span>
                </MetaRow>
              </div>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void submit("start")}
              disabled={!canSubmit}
            >
              {submitting === "start" ? <Spinner aria-label="Creating issue" /> : <GitBranchIcon />}
              Create & start work
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void submit("create")}
              disabled={!canSubmit}
            >
              {submitting === "create" ? <Spinner aria-label="Creating issue" /> : null}
              {submitting === "create" ? "Creating issue…" : "Create issue"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      {/* Outside the create dialog, which the caller closes once the issue exists. */}
      {startWork ? (
        <IssueWorktreeDialog
          open
          onOpenChange={(next) => {
            if (!next) setStartWork(null);
          }}
          environmentId={startWork.environmentId}
          reference={startWork.reference}
          issueTitle={startWork.title}
          linkedWork={null}
          canLink={startWork.canLink}
          onActed={() => refreshEnvironmentShell(startWork.environmentId)}
        />
      ) : null}
    </>
  );
}
