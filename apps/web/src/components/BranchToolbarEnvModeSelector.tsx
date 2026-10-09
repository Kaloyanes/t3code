import { ComposerSelectControl } from "./chat/ComposerControl";
import { ComposerContextLabel } from "./ComposerContextLabel";
import { FolderGit2Icon, FolderGitIcon, FolderIcon } from "lucide-react";
import { memo, useMemo, type MouseEvent as ReactMouseEvent } from "react";

import {
  resolveCurrentWorkspaceLabel,
  resolveEnvModeLabel,
  resolveLockedWorkspaceLabel,
  type EnvMode,
  type ExistingWorktreeOption,
} from "./BranchToolbar.logic";
import { useComposerMenuProps } from "./chat/composerEventScope";
import { PreviousWorktreeItemContent } from "./PreviousWorktreeItemContent";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectValue,
} from "./ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const PREVIOUS_WORKTREE_SELECT_VALUE = "previous-worktree";
const EXISTING_WORKTREE_SELECT_PREFIX = "existing-worktree:";
const NO_EXISTING_WORKTREES: ReadonlyArray<ExistingWorktreeOption> = [];

interface BranchToolbarEnvModeSelectorProps {
  forceNewWorktree?: boolean;
  envLocked: boolean;
  effectiveEnvMode: EnvMode;
  activeWorktreePath: string | null;
  onEnvModeChange: (mode: EnvMode) => void;
  previousWorktreeLabel?: string | null;
  previousWorktreeBranch?: string | null;
  onUsePreviousWorktree?: () => void;
  /** The branch checked out in the project folder, shown on the local choice. */
  currentCheckoutBranch?: string | null;
  existingWorktrees?: ReadonlyArray<ExistingWorktreeOption>;
  onSelectExistingWorktree?: (worktreePath: string) => void;
}

export const BranchToolbarEnvModeSelector = memo(function BranchToolbarEnvModeSelector({
  forceNewWorktree = false,
  envLocked,
  effectiveEnvMode,
  activeWorktreePath,
  onEnvModeChange,
  previousWorktreeLabel,
  previousWorktreeBranch = null,
  onUsePreviousWorktree,
  currentCheckoutBranch = null,
  existingWorktrees = NO_EXISTING_WORKTREES,
  onSelectExistingWorktree,
}: BranchToolbarEnvModeSelectorProps) {
  const selectedExistingWorktree =
    activeWorktreePath === null
      ? undefined
      : existingWorktrees.find((option) => option.worktreePath === activeWorktreePath);
  const composerFloatingLayerProps = useComposerMenuProps();
  const showPreviousWorktree = Boolean(previousWorktreeLabel && onUsePreviousWorktree);
  const envModeItems = useMemo(
    () => [
      {
        value: "local",
        label: resolveCurrentWorkspaceLabel(activeWorktreePath, currentCheckoutBranch),
      },
      { value: "worktree", label: resolveEnvModeLabel("worktree") },
      ...(showPreviousWorktree && previousWorktreeLabel
        ? [{ value: PREVIOUS_WORKTREE_SELECT_VALUE, label: previousWorktreeLabel }]
        : []),
      ...existingWorktrees.map((option) => ({
        value: `${EXISTING_WORKTREE_SELECT_PREFIX}${option.worktreePath}`,
        label: option.label,
      })),
    ],
    [
      activeWorktreePath,
      currentCheckoutBranch,
      existingWorktrees,
      previousWorktreeLabel,
      showPreviousWorktree,
    ],
  );

  const stopContextMenuMouseDown = (event: ReactMouseEvent) => {
    if (event.button !== 0 || event.ctrlKey) {
      event.stopPropagation();
    }
  };

  if (envLocked || forceNewWorktree) {
    const lockedRow = (
      <span
        className="inline-flex h-7 min-w-0 items-center gap-1 border border-transparent px-1.75 font-normal text-muted-foreground/70 text-xs sm:h-6"
        data-composer-context-control
      >
        {activeWorktreePath ? (
          <FolderGitIcon className="size-3" />
        ) : effectiveEnvMode === "worktree" ? (
          <FolderGit2Icon className="size-3" />
        ) : (
          <FolderIcon className="size-3" />
        )}
        <ComposerContextLabel>
          {forceNewWorktree
            ? resolveEnvModeLabel("worktree")
            : resolveLockedWorkspaceLabel(activeWorktreePath, effectiveEnvMode)}
        </ComposerContextLabel>
      </span>
    );

    return (
      <Tooltip>
        <TooltipTrigger render={lockedRow} />
        <TooltipPopup>
          {forceNewWorktree
            ? "Each model starts in its own worktree."
            : resolveLockedWorkspaceLabel(activeWorktreePath, effectiveEnvMode)}
        </TooltipPopup>
      </Tooltip>
    );
  }

  return (
    <Select
      modal={false}
      value={
        selectedExistingWorktree
          ? `${EXISTING_WORKTREE_SELECT_PREFIX}${selectedExistingWorktree.worktreePath}`
          : effectiveEnvMode
      }
      onValueChange={(value: string | null) => {
        if (value?.startsWith(EXISTING_WORKTREE_SELECT_PREFIX)) {
          onSelectExistingWorktree?.(value.slice(EXISTING_WORKTREE_SELECT_PREFIX.length));
          return;
        }
        if (value === PREVIOUS_WORKTREE_SELECT_VALUE) {
          onUsePreviousWorktree?.();
          return;
        }
        if (value === "local" || value === "worktree") onEnvModeChange(value);
      }}
      items={envModeItems}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <ComposerSelectControl
              size="xs"
              className="min-w-0 shrink"
              aria-label="Workspace"
              data-composer-shortcut="composer.workspace"
              data-composer-context-control
              onMouseDownCapture={stopContextMenuMouseDown}
            />
          }
        >
          {effectiveEnvMode === "worktree" ? (
            <FolderGit2Icon className="size-3" />
          ) : activeWorktreePath ? (
            <FolderGitIcon className="size-3" />
          ) : (
            <FolderIcon className="size-3" />
          )}
          <ComposerContextLabel>
            <SelectValue />
          </ComposerContextLabel>
        </TooltipTrigger>
        <TooltipPopup>
          {effectiveEnvMode === "worktree"
            ? resolveEnvModeLabel("worktree")
            : resolveCurrentWorkspaceLabel(activeWorktreePath, currentCheckoutBranch)}
        </TooltipPopup>
      </Tooltip>
      <SelectPopup
        alignItemWithTrigger={false}
        {...composerFloatingLayerProps}
        className={
          showPreviousWorktree || existingWorktrees.length > 0
            ? "w-[min(21rem,calc(100vw-2rem))]"
            : undefined
        }
      >
        <SelectGroup>
          <SelectGroupLabel>Workspace</SelectGroupLabel>
          <SelectItem value="local">
            <span className="inline-flex items-center gap-1.5">
              {activeWorktreePath ? (
                <FolderGitIcon className="size-3" />
              ) : (
                <FolderIcon className="size-3" />
              )}
              {resolveCurrentWorkspaceLabel(activeWorktreePath, currentCheckoutBranch)}
            </span>
          </SelectItem>
          <SelectItem value="worktree">
            <span className="inline-flex items-center gap-1.5">
              <FolderGit2Icon className="size-3" />
              {resolveEnvModeLabel("worktree")}
            </span>
          </SelectItem>
          {showPreviousWorktree && previousWorktreeLabel ? (
            <SelectItem value={PREVIOUS_WORKTREE_SELECT_VALUE}>
              <PreviousWorktreeItemContent branch={previousWorktreeBranch} />
            </SelectItem>
          ) : null}
        </SelectGroup>
        {existingWorktrees.length > 0 ? (
          <SelectGroup>
            <SelectGroupLabel>Existing worktrees</SelectGroupLabel>
            {existingWorktrees.map((option) => (
              <SelectItem
                key={option.worktreePath}
                value={`${EXISTING_WORKTREE_SELECT_PREFIX}${option.worktreePath}`}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <FolderGitIcon className="size-3" />
                  <span className="min-w-0 truncate">{option.label}</span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        ) : null}
      </SelectPopup>
    </Select>
  );
});
