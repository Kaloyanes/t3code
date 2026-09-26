import { FolderGit2Icon, FolderGitIcon, FolderIcon } from "lucide-react";
import { memo, useMemo } from "react";

import {
  resolveCurrentWorkspaceLabel,
  resolveEnvModeLabel,
  resolveLockedWorkspaceLabel,
  resolveWorktreeDisplayLabel,
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
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const EXISTING_WORKTREE_SELECT_PREFIX = "existing-worktree:";

interface BranchToolbarEnvModeSelectorProps {
  forceNewWorktree?: boolean;
  envLocked: boolean;
  effectiveEnvMode: EnvMode;
  activeWorktreePath: string | null;
  activeThreadBranch?: string | null;
  currentCheckoutBranch?: string | null;
  onEnvModeChange: (mode: EnvMode) => void;
  existingWorktrees?: ReadonlyArray<ExistingWorktreeOption>;
  onSelectExistingWorktree?: (worktreePath: string) => void;
  previousWorktree?: ExistingWorktreeOption | null;
  onUsePreviousWorktree?: () => void;
}

export const BranchToolbarEnvModeSelector = memo(function BranchToolbarEnvModeSelector({
  forceNewWorktree = false,
  envLocked,
  effectiveEnvMode,
  activeWorktreePath,
  activeThreadBranch,
  currentCheckoutBranch,
  onEnvModeChange,
  existingWorktrees = [],
  onSelectExistingWorktree,
  previousWorktree,
  onUsePreviousWorktree,
}: BranchToolbarEnvModeSelectorProps) {
  const composerFloatingLayerProps = useComposerMenuProps();
  const selectedValue = activeWorktreePath
    ? `${EXISTING_WORKTREE_SELECT_PREFIX}${activeWorktreePath}`
    : effectiveEnvMode;
  const worktreeLabel = activeWorktreePath
    ? resolveWorktreeDisplayLabel(activeWorktreePath, activeThreadBranch ?? null, existingWorktrees)
    : null;
  const envModeItems = useMemo(
    () => [
      {
        value: "local",
        label: resolveCurrentWorkspaceLabel(activeWorktreePath, currentCheckoutBranch),
      },
      { value: "worktree", label: resolveEnvModeLabel("worktree") },
      ...existingWorktrees.map((option) => ({
        value: `${EXISTING_WORKTREE_SELECT_PREFIX}${option.worktreePath}`,
        label: option.label,
      })),
    ],
    [activeWorktreePath, currentCheckoutBranch, existingWorktrees],
  );

  if (envLocked || forceNewWorktree) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={<span />}
          className="inline-flex h-7 min-w-0 items-center gap-1 border border-transparent px-1.75 font-normal text-muted-foreground/70 text-xs sm:h-6"
          data-composer-context-control
        >
          {activeWorktreePath ? (
            <FolderGitIcon className="size-3 shrink-0" />
          ) : effectiveEnvMode === "worktree" ? (
            <FolderGit2Icon className="size-3 shrink-0" />
          ) : (
            <FolderIcon className="size-3 shrink-0" />
          )}
          <span
            data-composer-label
            className="min-w-0 max-w-[240px] group-data-[compact]/composer-context:max-w-0"
          >
            <span
              data-composer-label-motion
              className="block w-full min-w-0 max-w-[240px] truncate text-foreground/80 transition-opacity duration-180 ease-[cubic-bezier(0.32,0.72,0,1)] group-data-[compact]/composer-context:opacity-0 motion-reduce:transition-none"
            >
              {forceNewWorktree
                ? resolveEnvModeLabel("worktree")
                : (worktreeLabel ?? "Local checkout")}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipPopup>
          {forceNewWorktree
            ? "Each model starts in its own worktree."
            : activeWorktreePath
              ? `${worktreeLabel} · ${activeWorktreePath}. Start a new thread to use another workspace.`
              : resolveLockedWorkspaceLabel(null, effectiveEnvMode)}
        </TooltipPopup>
      </Tooltip>
    );
  }

  return (
    <Select
      modal={false}
      value={selectedValue}
      onValueChange={(value: string | null) => {
        if (value?.startsWith(EXISTING_WORKTREE_SELECT_PREFIX)) {
          onSelectExistingWorktree?.(value.slice(EXISTING_WORKTREE_SELECT_PREFIX.length));
          return;
        }
        if (value === "previous-worktree") {
          onUsePreviousWorktree?.();
          return;
        }
        if (value === "local" || value === "worktree") onEnvModeChange(value);
      }}
      items={
        previousWorktree
          ? [...envModeItems, { value: "previous-worktree", label: previousWorktree.label }]
          : envModeItems
      }
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <SelectTrigger
              variant="ghost"
              size="xs"
              className="min-w-0 shrink"
              aria-label="Workspace"
              data-composer-shortcut="composer.workspace"
              data-composer-context-control
            />
          }
        >
          {activeWorktreePath ? (
            <FolderGitIcon className="size-3" />
          ) : effectiveEnvMode === "worktree" ? (
            <FolderGit2Icon className="size-3" />
          ) : (
            <FolderIcon className="size-3" />
          )}
          <span
            data-composer-label
            className="min-w-0 max-w-[240px] group-data-[compact]/composer-context:max-w-0"
          >
            <span
              data-composer-label-motion
              className="block w-full min-w-0 max-w-[240px] truncate text-foreground/80 transition-opacity duration-180 ease-[cubic-bezier(0.32,0.72,0,1)] group-data-[compact]/composer-context:opacity-0 motion-reduce:transition-none"
            >
              {worktreeLabel ?? <SelectValue />}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipPopup>
          {activeWorktreePath
            ? `${worktreeLabel} · ${activeWorktreePath}`
            : effectiveEnvMode === "worktree"
              ? resolveEnvModeLabel("worktree")
              : resolveCurrentWorkspaceLabel(null, currentCheckoutBranch)}
        </TooltipPopup>
      </Tooltip>
      <SelectPopup
        alignItemWithTrigger={false}
        className="w-[min(21rem,calc(100vw-2rem))]"
        {...composerFloatingLayerProps}
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
          {previousWorktree ? (
            <SelectItem value="previous-worktree">
              <PreviousWorktreeItemContent branch={previousWorktree.branch} />
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
