import {
  CircleCheckIcon,
  CircleDotIcon,
  CircleSlashIcon,
  SearchIcon,
  TagIcon,
  UserRoundPlusIcon,
  XIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { pullRequestLabelColor } from "../pullRequest/pullRequestList.logic";
import { PullRequestActorAvatar } from "../pullRequest/pullRequestPresentation";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { IssueActorFacet, IssueBulkAction, IssueLabelFacet } from "./issue.logic";

/** A name picker for the bar: the loaded names, filtered as typed, or the typed name itself. */
function BulkPickerMenu({
  trigger,
  noun,
  disabled,
  options,
  onPick,
  onOpenChange,
}: {
  trigger: ReactNode;
  /** Singular, lowercase: "label", "assignee". */
  noun: string;
  disabled: boolean;
  options: ReadonlyArray<{
    readonly value: string;
    readonly label: ReactNode;
    readonly search: string;
  }>;
  onPick: (value: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = options
    .filter((option) => needle.length === 0 || option.search.toLowerCase().includes(needle))
    .slice(0, 12);
  const exact = options.some((option) => option.value.toLowerCase() === needle);
  return (
    <Menu
      onOpenChange={(open) => {
        if (!open) setQuery("");
        onOpenChange(open);
      }}
    >
      <MenuTrigger disabled={disabled} render={<Button size="sm" variant="ghost" />}>
        {trigger}
      </MenuTrigger>
      <MenuPopup align="center" side="top">
        <div className="p-1 pb-2">
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
              autoFocus
              size="compact"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown" && event.key !== "Escape") event.stopPropagation();
              }}
              placeholder={`Find or type a ${noun}`}
              aria-label={`Find a ${noun}`}
            />
          </InputGroup>
        </div>
        {visible.map((option) => (
          <MenuItem key={option.value} onClick={() => onPick(option.value)}>
            {option.label}
          </MenuItem>
        ))}
        {needle.length > 0 && !exact ? (
          <>
            {visible.length > 0 ? <MenuSeparator /> : null}
            <MenuItem onClick={() => onPick(query.trim())}>
              Use “{query.trim().slice(0, 60)}”
            </MenuItem>
          </>
        ) : visible.length === 0 ? (
          <MenuItem disabled>No {noun}s loaded</MenuItem>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

/**
 * What the reader can do to every checked issue at once. It floats at the bottom of the list
 * while anything is checked; the page runs each change in turn and reports per issue.
 */
export function IssueBulkActionBar({
  count,
  canClose,
  canReopen,
  running,
  outdated,
  labelOptions,
  assigneeOptions,
  onPickerOpenChange,
  onAction,
  onClear,
}: {
  count: number;
  canClose: boolean;
  canReopen: boolean;
  /** A batch is going; the controls wait for it rather than queue a second. */
  running: boolean;
  /** The rows are saved or carried over, not a live answer, so nothing acts on them yet. */
  outdated: boolean;
  labelOptions: ReadonlyArray<IssueLabelFacet>;
  assigneeOptions: ReadonlyArray<IssueActorFacet>;
  /** A picker opened, so the page can fetch the repository's own candidates. */
  onPickerOpenChange: (open: boolean) => void;
  onAction: (action: IssueBulkAction) => void;
  onClear: () => void;
}) {
  const blocked = running || outdated;
  const actions = (
    <>
      <Menu>
        <MenuTrigger disabled={blocked || !canClose} render={<Button size="sm" variant="ghost" />}>
          <CircleCheckIcon aria-hidden className="size-3.5" />
          Close
        </MenuTrigger>
        <MenuPopup align="center" side="top">
          <MenuItem onClick={() => onAction({ kind: "close", reason: "completed" })}>
            <CircleCheckIcon aria-hidden />
            Close as completed
          </MenuItem>
          <MenuItem onClick={() => onAction({ kind: "close", reason: "not-planned" })}>
            <CircleSlashIcon aria-hidden />
            Close as not planned
          </MenuItem>
        </MenuPopup>
      </Menu>
      <Button
        size="sm"
        variant="ghost"
        disabled={blocked || !canReopen}
        onClick={() => onAction({ kind: "reopen" })}
      >
        <CircleDotIcon aria-hidden className="size-3.5" />
        Reopen
      </Button>
      <BulkPickerMenu
        noun="label"
        disabled={blocked}
        trigger={
          <>
            <TagIcon aria-hidden className="size-3.5" />
            Add label
          </>
        }
        options={labelOptions.map((option) => {
          const dot = pullRequestLabelColor(option.color);
          return {
            value: option.name,
            search: option.name,
            label: (
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full bg-muted-foreground"
                  {...(dot ? { style: { backgroundColor: dot } } : {})}
                />
                <span className="min-w-0 truncate">{option.name}</span>
              </span>
            ),
          };
        })}
        onPick={(label) => onAction({ kind: "add-label", label })}
        onOpenChange={onPickerOpenChange}
      />
      <BulkPickerMenu
        noun="assignee"
        disabled={blocked}
        trigger={
          <>
            <UserRoundPlusIcon aria-hidden className="size-3.5" />
            Assign
          </>
        }
        options={assigneeOptions.map((option) => ({
          value: option.actor.login,
          search: `${option.actor.login} ${option.actor.name ?? ""}`,
          label: (
            <span className="flex min-w-0 items-center gap-2">
              <PullRequestActorAvatar actor={option.actor} />
              <span className="min-w-0 truncate">{option.actor.login}</span>
            </span>
          ),
        }))}
        onPick={(login) => onAction({ kind: "assign", login })}
        onOpenChange={onPickerOpenChange}
      />
    </>
  );
  return (
    <div className="pointer-events-none sticky bottom-3 z-10 flex justify-center">
      <div
        role="toolbar"
        aria-label="Selected issues"
        className="pointer-events-auto flex items-center gap-0.5 rounded-lg border bg-popover px-1.5 py-1 text-sm text-popover-foreground shadow-lg"
      >
        <span className="flex items-center gap-1.5 px-1.5 tabular-nums">
          {running ? <Spinner aria-hidden size="sm" /> : null}
          {count} selected
        </span>
        {outdated ? (
          <Tooltip>
            <TooltipTrigger render={<span className="flex items-center gap-0.5" />}>
              {actions}
            </TooltipTrigger>
            <TooltipPopup side="top">
              These issues may have changed on GitHub. Refresh the list to act on them.
            </TooltipPopup>
          </Tooltip>
        ) : (
          actions
        )}
        <Button size="icon-sm" variant="ghost" aria-label="Clear selection" onClick={onClear}>
          <XIcon aria-hidden className="size-4" />
        </Button>
      </div>
    </div>
  );
}
