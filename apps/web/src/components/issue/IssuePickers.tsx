/**
 * The label and assignee pickers an issue shares between its Summary tab and the New issue
 * dialog. Both are the pull request pickers' combobox: the repository's candidates are read only
 * once a picker opens, and a pick toggles one name without closing it. What a toggle does is the
 * caller's — an update on the host, or a change to a draft.
 */
import type {
  EnvironmentId,
  IssueAssigneeCandidate,
  IssueLabelCandidate,
  IssueRepositorySelection,
} from "@t3tools/contracts";
import { CheckIcon, TagIcon, UserPlusIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useIssueCandidates } from "~/state/issues";

import { PullRequestCandidatePicker } from "../pullRequest/PullRequestCandidatePicker";
import { pullRequestLabelColor } from "../pullRequest/pullRequestList.logic";
import { PullRequestActorAvatar } from "../pullRequest/pullRequestPresentation";
import { hasIssueName, issueCandidatesInput } from "./issueDetail.logic";

/** The candidates read asks for this many; a full page means the host may hold more. */
const CANDIDATE_LIMIT = 100;

interface IssuePickerProps {
  readonly environmentId: EnvironmentId;
  readonly selection: IssueRepositorySelection;
  /** Names currently applied, including any change still on its way to the host. */
  readonly selected: ReadonlyArray<string>;
  readonly onToggle: (name: string, applied: boolean) => void;
  /** False where the host would refuse this account's change; disabled with the reason. */
  readonly allowed: boolean;
  /** Locks the rows while one change is in flight. */
  readonly disabled?: boolean;
}

function matches(query: string, ...fields: ReadonlyArray<string | null | undefined>): boolean {
  if (query.length === 0) return true;
  const needle = query.toLowerCase();
  return fields.some((field) => (field ?? "").toLowerCase().includes(needle));
}

export function IssueLabelPicker({
  environmentId,
  selection,
  selected,
  onToggle,
  allowed,
  disabled = false,
}: IssuePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const candidatesQuery = useIssueCandidates(
    open ? { environmentId, input: issueCandidatesInput(selection, "labels") } : null,
  );
  const all: ReadonlyArray<IssueLabelCandidate> =
    candidatesQuery.data?._tag === "labels" ? candidatesQuery.data.candidates : [];
  const candidates = useMemo(
    () => all.filter((candidate) => matches(query, candidate.name, candidate.description)),
    [all, query],
  );

  return (
    <PullRequestCandidatePicker
      icon={<TagIcon className="size-3.5" />}
      label="Change labels"
      allowed={allowed}
      disabledReason="Changing labels needs triage access on this repository"
      open={open}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
      searchLabel="Search labels"
      isPending={candidatesQuery.isPending && candidatesQuery.data === null}
      error={candidatesQuery.data === null ? candidatesQuery.error : null}
      candidates={candidates}
      emptyLabel="This repository has no labels."
      noMatchLabel="No label matches that."
      errorLabel="The labels could not be read."
      truncated={all.length >= CANDIDATE_LIMIT}
      truncatedLabel="This repository has more labels than are listed here. Apply the rest on GitHub."
      candidateKey={(candidate) => candidate.name}
      disabled={disabled}
      onSelect={(candidate) => onToggle(candidate.name, !hasIssueName(selected, candidate.name))}
    >
      {(candidate) => {
        const dot = pullRequestLabelColor(candidate.color);
        return (
          <>
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full bg-muted-foreground"
              {...(dot ? { style: { backgroundColor: dot } } : {})}
            />
            <span className="min-w-0 flex-1 truncate">
              {candidate.name}
              {candidate.description ? (
                <span className="text-muted-foreground"> · {candidate.description}</span>
              ) : null}
            </span>
            {hasIssueName(selected, candidate.name) ? (
              <CheckIcon aria-label="Applied" className="size-3.5 shrink-0" />
            ) : null}
          </>
        );
      }}
    </PullRequestCandidatePicker>
  );
}

export function IssueAssigneePicker({
  environmentId,
  selection,
  selected,
  onToggle,
  allowed,
  disabled = false,
}: IssuePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const candidatesQuery = useIssueCandidates(
    open ? { environmentId, input: issueCandidatesInput(selection, "assignees") } : null,
  );
  const all: ReadonlyArray<IssueAssigneeCandidate> =
    candidatesQuery.data?._tag === "assignees" ? candidatesQuery.data.candidates : [];
  const candidates = useMemo(
    () => all.filter((candidate) => matches(query, candidate.login, candidate.name)),
    [all, query],
  );

  return (
    <PullRequestCandidatePicker
      icon={<UserPlusIcon className="size-3.5" />}
      label="Change assignees"
      allowed={allowed}
      disabledReason="Assigning people needs triage access on this repository"
      open={open}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
      searchLabel="Search people"
      isPending={candidatesQuery.isPending && candidatesQuery.data === null}
      error={candidatesQuery.data === null ? candidatesQuery.error : null}
      candidates={candidates}
      emptyLabel="Nobody can be assigned in this repository."
      noMatchLabel="Nobody matches that."
      errorLabel="The people who can be assigned could not be read."
      truncated={all.length >= CANDIDATE_LIMIT}
      truncatedLabel="More people can be assigned than are listed here. Assign the rest on GitHub."
      candidateKey={(candidate) => candidate.login}
      disabled={disabled}
      onSelect={(candidate) => onToggle(candidate.login, !hasIssueName(selected, candidate.login))}
    >
      {(candidate) => (
        <>
          <PullRequestActorAvatar actor={candidate} />
          <span className="min-w-0 flex-1 truncate">
            {candidate.login}
            {candidate.name && candidate.name !== candidate.login ? (
              <span className="text-muted-foreground"> · {candidate.name}</span>
            ) : null}
          </span>
          {hasIssueName(selected, candidate.login) ? (
            <CheckIcon aria-label="Assigned" className="size-3.5 shrink-0" />
          ) : null}
        </>
      )}
    </PullRequestCandidatePicker>
  );
}
