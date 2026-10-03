import type { EnvironmentId, IssueRepositorySelection, ProjectId } from "@t3tools/contracts";
import { CircleDotIcon, ExternalLinkIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { readLocalApi } from "../../localApi";
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
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from "../ui/combobox";
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
import { Textarea } from "../ui/textarea";
import { issueRepositoryUrl } from "./issue.logic";
import { IssueLabelPill } from "./IssueLabelPill";

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
export function IssueCreateDialog({
  open,
  onOpenChange,
  selection,
  environmentId,
  onCreated,
}: IssueCreateDialogProps) {
  const templatesQuery = useIssueTemplates(
    open && selection && environmentId ? { environmentId, input: selection } : null,
  );
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [labels, setLabels] = useState("");
  const [assignees, setAssignees] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const assigneeQuery = assignees.split(",").at(-1)?.trim().slice(0, 200) ?? "";
  const labelsCandidatesQuery = useIssueCandidates(
    open && selection && environmentId
      ? {
          environmentId,
          input: {
            ...selection,
            kind: "labels",
            limit: 100,
          },
        }
      : null,
  );
  const assigneesCandidatesQuery = useIssueCandidates(
    open && selection && environmentId
      ? {
          environmentId,
          input: {
            ...selection,
            kind: "assignees",
            limit: 100,
            ...(assigneeQuery ? { query: assigneeQuery } : {}),
          },
        }
      : null,
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
    setLabels(draft?.labels.join(", ") ?? "");
    setAssignees(draft?.assignees.join(", ") ?? "");
    setError(null);
    setIsSubmitting(false);
  }, [open, selection]);
  useEffect(() => {
    if (!open || !selection) return;
    const timer = window.setTimeout(
      () =>
        writeIssueDraft(
          typeof window === "undefined" ? undefined : window.localStorage,
          selection,
          {
            ...(templateId ? { templateId } : {}),
            title,
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
        ),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [assignees, body, labels, open, selection, templateId, title]);
  const selectedTemplate =
    templatesQuery.data?.templates.find((template) => template.id === templateId) ?? null;
  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const template = templatesQuery.data?.templates.find((entry) => entry.id === id);
    if (!template) {
      setTitle("");
      setBody("");
      setLabels("");
      setAssignees("");
      return;
    }
    setTitle(template.title ?? "");
    setBody(template.body ?? "");
    setLabels(template.labels.join(", "));
    setAssignees(template.assignees.join(", "));
  };
  const submit = async () => {
    if (
      isSubmitting ||
      selectedTemplate?.kind === "issue-form" ||
      !selection ||
      environmentId === null ||
      title.trim().length === 0
    ) {
      return;
    }
    setIsSubmitting(true);
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
          ...(labels.trim()
            ? {
                labels: labels
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
              }
            : {}),
          ...(assignees.trim()
            ? {
                assignees: assignees
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
              }
            : {}),
        },
      });
      if (result._tag === "Success") {
        const issue = result.value.issue;
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
      setIsSubmitting(false);
    }
  };
  const openExternalForm = () => {
    if (!selection || isSubmitting) return;
    void readLocalApi()?.shell.openExternal(`${issueRepositoryUrl(selection)}/issues/new`);
  };
  const labelCandidates =
    labelsCandidatesQuery.data?._tag === "labels"
      ? labelsCandidatesQuery.data.candidates.map((candidate) => ({
          value: candidate.name,
          label: candidate.name,
          color: candidate.color,
        }))
      : [];
  const assigneeCandidates =
    assigneesCandidatesQuery.data?._tag === "assignees"
      ? assigneesCandidatesQuery.data.candidates.map((candidate) => ({
          value: candidate.login,
          label: candidate.login,
          detail: candidate.name,
        }))
      : [];
  return (
    <Dialog open={open} onOpenChange={isSubmitting ? undefined : onOpenChange}>
      <DialogPopup className="max-w-2xl" showCloseButton={!isSubmitting}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircleDotIcon className="size-4" />
            New issue
          </DialogTitle>
          <DialogDescription>
            Create an issue in {selection?.repository ?? "the selected repository"}.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
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
          <div>
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
                className="mt-1"
                aria-labelledby="issue-template-label"
                disabled={templatesQuery.isPending || isSubmitting}
              >
                <SelectValue>
                  {selectedTemplate
                    ? `${selectedTemplate.name}${selectedTemplate.kind === "issue-form" ? " · structured form" : ""}`
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
          {selectedTemplate?.kind === "issue-form" ? (
            <div className="rounded-lg border border-warning/30 bg-warning-surface/35 p-3 text-sm">
              <p className="font-medium">This template is a structured GitHub form.</p>
              <p className="mt-1 text-muted-foreground">
                T3 Code keeps the form fields on GitHub so validation and dropdowns work correctly.
              </p>
              <Button size="sm" variant="outline" className="mt-3" onClick={openExternalForm}>
                Open form on GitHub <ExternalLinkIcon />
              </Button>
            </div>
          ) : null}
          <label className="block text-sm font-medium">
            Title
            <Input
              className="mt-1"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What needs attention?"
              autoFocus
              disabled={isSubmitting || selectedTemplate?.kind === "issue-form"}
            />
          </label>
          <label className="block text-sm font-medium">
            Body
            <Textarea
              className="mt-1"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Describe the problem or idea"
              rows={10}
              disabled={isSubmitting || selectedTemplate?.kind === "issue-form"}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <IssueCandidateField
              label="Labels"
              value={labels}
              onChange={setLabels}
              placeholder="bug, enhancement"
              candidates={labelCandidates}
              isPending={labelsCandidatesQuery.isPending}
              error={labelsCandidatesQuery.error}
              disabled={isSubmitting || selectedTemplate?.kind === "issue-form"}
            />
            <IssueCandidateField
              label="Assignees"
              value={assignees}
              onChange={setAssignees}
              placeholder="github-login"
              candidates={assigneeCandidates}
              isPending={assigneesCandidatesQuery.isPending}
              error={assigneesCandidatesQuery.error}
              disabled={isSubmitting || selectedTemplate?.kind === "issue-form"}
            />
          </div>
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
            onClick={() => void submit()}
            disabled={
              isSubmitting ||
              selectedTemplate?.kind === "issue-form" ||
              !selection ||
              environmentId === null ||
              title.trim().length === 0
            }
          >
            {isSubmitting ? <Spinner aria-label="Creating issue" /> : null}
            {isSubmitting ? "Creating issue…" : "Create issue"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

interface IssueCandidate {
  readonly value: string;
  readonly label: string;
  readonly detail?: string | null;
  readonly color?: string | null;
}

function IssueCandidateField({
  label,
  value,
  onChange,
  placeholder,
  candidates,
  isPending,
  error,
  disabled,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly candidates: ReadonlyArray<IssueCandidate>;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const query = value.split(",").at(-1)?.trim().toLowerCase() ?? "";
  const filteredCandidates = candidates.filter((candidate) =>
    candidate.label.toLowerCase().includes(query),
  );
  const items = candidates.map((candidate) => candidate.value);
  const filteredItems = filteredCandidates.map((candidate) => candidate.value);
  const selectedValues = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const selectCandidate = (candidateValue: string | null) => {
    if (candidateValue === null) return;
    const selected = candidates.find((candidate) => candidate.value === candidateValue);
    if (!selected) return;
    const committed = value
      .split(",")
      .slice(0, -1)
      .map((item) => item.trim())
      .filter(Boolean);
    if (committed.some((item) => item.toLowerCase() === selected.value.toLowerCase())) return;
    onChange([...committed, selected.value].join(", "));
    setOpen(false);
  };
  return (
    <label className="block text-sm font-medium">
      {label}
      <Combobox
        items={items}
        filteredItems={filteredItems}
        filter={null}
        value={null}
        open={open}
        onOpenChange={setOpen}
        onValueChange={selectCandidate}
      >
        {label === "Labels" && selectedValues.length > 0 ? (
          <span className="mt-1 flex flex-wrap gap-1">
            {selectedValues.map((name) => (
              <IssueLabelPill
                key={name}
                name={name}
                color={candidates.find((candidate) => candidate.value === name)?.color}
              />
            ))}
          </span>
        ) : null}
        <ComboboxInput
          className="mt-1"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          aria-label={label}
          disabled={disabled}
          showTrigger
        />
        <ComboboxPopup align="start" className="w-72">
          <ComboboxList className="max-h-48">
            {isPending ? (
              <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
                <Spinner aria-label={`Loading ${label.toLowerCase()}`} /> Loading suggestions…
              </div>
            ) : error !== null ? (
              <p className="p-2 text-xs text-muted-foreground">
                Suggestions unavailable. Enter {label.toLowerCase()} manually.
              </p>
            ) : filteredCandidates.length === 0 ? (
              <ComboboxEmpty>
                {query ? `No matching ${label.toLowerCase()}.` : `No ${label.toLowerCase()} found.`}
              </ComboboxEmpty>
            ) : (
              filteredCandidates.map((candidate, index) => (
                <ComboboxItem
                  key={candidate.value}
                  index={index}
                  value={candidate.value}
                  disabled={isPending}
                >
                  <span className="flex items-center justify-between gap-2">
                    {label === "Labels" ? (
                      <IssueLabelPill name={candidate.label} color={candidate.color} />
                    ) : (
                      <span className="truncate">{candidate.label}</span>
                    )}
                    {candidate.detail ? (
                      <span className="truncate text-xs text-muted-foreground">
                        {candidate.detail}
                      </span>
                    ) : null}
                  </span>
                </ComboboxItem>
              ))
            )}
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>
    </label>
  );
}
