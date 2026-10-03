import type { IssueInvolvement, IssueListFilters, IssueListState } from "@t3tools/contracts";
import { LayersIcon, ListFilterIcon, MilestoneIcon, ServerIcon } from "lucide-react";

import {
  PullRequestAuthorFilter,
  PullRequestFilterRadioSubmenu,
  PullRequestLabelFilter,
  type PullRequestFilterOption,
} from "../pullRequest/PullRequestListFilters";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import type { IssueActorFacet, IssueLabelFacet, IssueMilestoneFacet } from "./issue.logic";

/** The unset value of a radio group; no milestone or host is named the empty string. */
const ANY = "";

/**
 * The issue list's narrowings behind one control, built from the pull request menu's own pieces
 * so the two pages' menus read and behave as one. Labels are one OR group here, as GitHub's
 * issue filter treats a multi-pick; a typed `label:` per name still asks for all of them.
 */
export function IssueFiltersMenu({
  onOpenChange,
  state,
  stateOptions,
  onState,
  involvement,
  involvementOptions,
  onInvolvement,
  filters,
  onFilters,
  authorOptions,
  assigneeOptions,
  labelOptions,
  milestoneOptions,
  host,
  hostOptions,
  onHost,
}: {
  onOpenChange?: (open: boolean) => void;
  state: IssueListState;
  stateOptions: ReadonlyArray<PullRequestFilterOption<IssueListState>>;
  onState: (state: IssueListState) => void;
  involvement: IssueInvolvement;
  involvementOptions: ReadonlyArray<PullRequestFilterOption<IssueInvolvement>>;
  onInvolvement: (involvement: IssueInvolvement) => void;
  /** Only the menu's own narrowings; an absent field is unfiltered. */
  filters: Pick<IssueListFilters, "labels" | "author" | "assignee" | "milestone">;
  onFilters: (
    filters: Pick<IssueListFilters, "labels" | "author" | "assignee" | "milestone">,
  ) => void;
  authorOptions: ReadonlyArray<IssueActorFacet>;
  assigneeOptions: ReadonlyArray<IssueActorFacet>;
  labelOptions: ReadonlyArray<IssueLabelFacet>;
  milestoneOptions: ReadonlyArray<IssueMilestoneFacet>;
  /** One project's checkout can be read through more than one host; empty otherwise. */
  host: string | undefined;
  hostOptions: ReadonlyArray<string>;
  onHost: (host: string | undefined) => void;
}) {
  const selectedLabels = (filters.labels ?? []).flatMap((group) => group);
  const filterCount = [
    state !== "open",
    involvement !== "all",
    filters.author,
    filters.assignee,
    filters.milestone,
    ...selectedLabels,
  ].filter(Boolean).length;
  const update = (next: Partial<typeof filters>) =>
    onFilters(
      Object.fromEntries(
        Object.entries({ ...filters, ...next }).filter(([, value]) => value !== undefined),
      ) as typeof filters,
    );
  const milestones: ReadonlyArray<PullRequestFilterOption<string>> = [
    { value: ANY, label: "Any", Icon: LayersIcon },
    // A milestone typed or linked in that no loaded row carries is still the current choice.
    ...(filters.milestone &&
    !milestoneOptions.some(
      (option) => option.title.toLowerCase() === filters.milestone?.toLowerCase(),
    )
      ? [{ value: filters.milestone, label: filters.milestone, Icon: MilestoneIcon }]
      : []),
    ...milestoneOptions.map((option) => ({
      value: option.title,
      label: `${option.title} · ${option.count}`,
      Icon: MilestoneIcon,
    })),
  ];
  return (
    <Menu onOpenChange={onOpenChange}>
      <MenuTrigger render={<Button variant="outline" />}>
        <ListFilterIcon className="size-4" />
        <span>Filters</span>
        {filterCount > 0 ? (
          <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
            {filterCount}
          </span>
        ) : null}
      </MenuTrigger>
      <MenuPopup align="end" side="bottom">
        <PullRequestFilterRadioSubmenu
          label="State"
          value={state}
          options={stateOptions}
          onChange={onState}
        />
        <PullRequestFilterRadioSubmenu
          label="Involvement"
          value={involvement}
          options={involvementOptions}
          onChange={onInvolvement}
        />
        <MenuSeparator />
        <PullRequestLabelFilter
          value={selectedLabels}
          options={labelOptions}
          onChange={(labels) =>
            update({ labels: labels.length === 0 ? undefined : [labels.slice(0, 25)] })
          }
        />
        <PullRequestAuthorFilter
          value={filters.author}
          options={authorOptions}
          onChange={(author) => update({ author })}
          detail={(option) => `${option.count} shown`}
        />
        <PullRequestAuthorFilter
          label="Assignee"
          noun="assignees"
          value={filters.assignee}
          options={assigneeOptions}
          onChange={(assignee) => update({ assignee })}
          detail={(option) => `${option.count} shown`}
        />
        <PullRequestFilterRadioSubmenu
          label="Milestone"
          value={
            milestones.find(
              (option) => option.value.toLowerCase() === (filters.milestone ?? ANY).toLowerCase(),
            )?.value ?? ANY
          }
          options={milestones}
          onChange={(milestone) => update({ milestone: milestone === ANY ? undefined : milestone })}
        />
        {hostOptions.length > 1 ? (
          <>
            <MenuSeparator />
            <PullRequestFilterRadioSubmenu
              label="Host"
              value={host ?? hostOptions[0] ?? ANY}
              options={hostOptions.map((value) => ({ value, label: value, Icon: ServerIcon }))}
              onChange={(next) => onHost(next)}
            />
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
