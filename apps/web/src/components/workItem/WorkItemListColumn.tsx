/**
 * The list column the pull request and issue pages share: a work item is either one. The page
 * owns its reads, filters and rows; this owns the chrome around them — the in-flow toolbar, the
 * topbar that condenses into the scope once that toolbar scrolls away, and the Mod+F search.
 */
import { ChevronDownIcon, SearchIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import {
  PullRequestFilterOptionIcon,
  type PullRequestFilterOption,
} from "../pullRequest/PullRequestListFilters";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { RefreshIcon } from "../ui/refresh-icon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

export type WorkItemFilterOption<Value extends string> = PullRequestFilterOption<Value>;
export { PullRequestFilterOptionIcon as WorkItemFilterOptionIcon };

/** A compact stand-in for one pill group when the header is narrow. */
export function CompactFilterMenu<Value extends string>({
  label,
  triggerIcon,
  triggerLabel,
  outlined = false,
  iconOnly = false,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  triggerIcon?: ReactNode;
  triggerLabel?: string;
  outlined?: boolean;
  iconOnly?: boolean;
  value: Value;
  options: ReadonlyArray<WorkItemFilterOption<Value>>;
  onChange: (value: Value) => void;
  className?: string;
}) {
  const current = options.find((option) => option.value === value) ?? options[0];
  if (!current) return null;
  return (
    <Menu>
      <MenuTrigger
        aria-label={triggerLabel || iconOnly ? `${label}: ${current.label}` : label}
        title={iconOnly ? `${label}: ${current.label}` : undefined}
        render={
          outlined ? (
            <Button variant="outline" size={iconOnly ? "icon" : "default"} />
          ) : (
            <Button variant="ghost-muted" size="sm" />
          )
        }
        className={cn("min-w-0", className)}
      >
        {iconOnly ? (
          <current.Icon aria-hidden className="size-4" />
        ) : triggerLabel ? (
          <>
            {triggerIcon}
            <span>{triggerLabel}</span>
          </>
        ) : (
          <>
            <span className="truncate">{current.label}</span>
            <ChevronDownIcon aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
          </>
        )}
      </MenuTrigger>
      <MenuPopup align="start" side="bottom">
        <MenuRadioGroup value={value} onValueChange={(next) => onChange(next as Value)}>
          {options.map((option) => {
            const item = (
              <MenuRadioItem
                key={option.value}
                value={option.value}
                disabled={option.unavailable !== undefined}
                className="data-disabled:pointer-events-auto"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <PullRequestFilterOptionIcon option={option} />
                  {option.label}
                </span>
              </MenuRadioItem>
            );
            return option.unavailable === undefined ? (
              item
            ) : (
              <Tooltip key={option.value}>
                <TooltipTrigger render={item} />
                <TooltipPopup side="right">{option.unavailable}</TooltipPopup>
              </Tooltip>
            );
          })}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

/**
 * The search, folded to an icon until asked for. Opening moves focus into the input — the
 * whole point of pressing it is to type. It stays open while it holds a query, so an active
 * search is never invisible; empty and blurred, it folds back.
 */
function ExpandableSearch({
  searchInput,
  searchValue,
  ariaLabel,
  open,
  onOpenChange,
  focusToken,
  onFocusWithin,
}: {
  searchInput: ReactNode;
  searchValue: string;
  /** Names the folded button. */
  ariaLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bumped to pull focus into the input while it is already showing — the Mod+F path. */
  focusToken: number;
  /**
   * Focus entering and leaving the expanded input. An unmount fires no blur, which is the
   * point: whoever unmounted this can still see the reader was mid-typing and move the
   * focus somewhere that continues the sentence.
   */
  onFocusWithin?: (focused: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    containerRef.current?.querySelector("input")?.focus();
  }, [open]);
  const appliedFocusToken = useRef(focusToken);
  useEffect(() => {
    if (appliedFocusToken.current === focusToken) return;
    appliedFocusToken.current = focusToken;
    const input = containerRef.current?.querySelector("input");
    input?.focus();
    input?.select();
  }, [focusToken]);
  if (open || searchValue.length > 0) {
    return (
      <div
        ref={containerRef}
        className="w-56 min-w-24 shrink"
        onFocus={() => onFocusWithin?.(true)}
        onBlur={() => {
          onFocusWithin?.(false);
          if (searchValue.length === 0) onOpenChange(false);
        }}
      >
        {searchInput}
      </div>
    );
  }
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={ariaLabel}
      onClick={() => onOpenChange(true)}
    >
      <SearchIcon className="size-4" />
    </Button>
  );
}

export interface WorkItemListColumnProps {
  /** The page title, e.g. "Pull Requests". */
  title: string;
  /** Names the condensed breadcrumb that carries the scope menus, e.g. "Pull request scope". */
  scopeAriaLabel: string;
  /** Names the plain title breadcrumb, e.g. "Pull requests breadcrumb". */
  breadcrumbAriaLabel: string;
  /** Names the folded topbar search button, e.g. "Search pull requests". */
  searchAriaLabel: string;
  /** Names both refresh buttons, e.g. "Refresh pull requests". */
  refreshAriaLabel: string;
  refreshing: boolean;
  onRefresh: () => void;
  searchValue: string;
  /** Rendered both in-flow and in the condensed topbar; they are one search to the reader. */
  searchInput: ReactNode;
  /**
   * The scope menus that follow the title once the toolbar scrolls away, usually a few
   * `CompactFilterMenu`s. Only rendered while condensed.
   */
  condensedFilters: ReactNode;
  /** The in-flow controls between the search and refresh: sort, filters, provider. */
  toolbar: ReactNode;
  rightPanelControl: ReactNode;
  titlebarControls: ReactNode;
  rightPanelOpen: boolean;
  listBody: ReactNode;
  scrollRef: RefObject<HTMLDivElement | null>;
}

/**
 * The work item list column. The full controls live at the top of the scroll flow; once they
 * scroll away, the title transforms into the scope itself — "Pull Requests / Open ▾ Authored ▾"
 * — where each segment is the menu for that filter, and a folded search sits on the right.
 * Scrolled back up, the topbar returns to the plain title. The topbar is the window drag region
 * throughout; its interactive children opt out through the `.drag-region` descendant rules.
 */
export function WorkItemListColumn({
  title,
  scopeAriaLabel,
  breadcrumbAriaLabel,
  searchAriaLabel,
  refreshAriaLabel,
  refreshing,
  onRefresh,
  searchValue,
  searchInput,
  condensedFilters,
  toolbar,
  rightPanelControl,
  titlebarControls,
  rightPanelOpen,
  listBody,
  scrollRef,
}: WorkItemListColumnProps) {
  const markerRef = useRef<HTMLDivElement | null>(null);
  const [condensed, setCondensed] = useState(false);
  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;
    const observer = new IntersectionObserver(
      ([entry]) => setCondensed(entry ? !entry.isIntersecting : false),
      { root: scrollRef.current },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, []);
  // Typing into the topbar search narrows the list, and a short enough list un-scrolls the
  // page — which dissolves the condensed topbar and unmounts the very input being typed in.
  // The two inputs are one search to the reader, so the focus follows the value into the
  // in-flow bar, caret at the end, and the sentence continues.
  const topbarSearchFocusedRef = useRef(false);
  const inFlowSearchRef = useRef<HTMLDivElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchExpanded = searchOpen || searchValue.length > 0;
  // Mod+F belongs to this page's own search: the desktop shell binds no find-in-page, so the
  // shortcut would otherwise do nothing. Condensed, it unfolds the topbar search; at the top,
  // it focuses the in-flow bar and selects the query the way a find field would.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key.toLowerCase() !== "f" || !(event.metaKey || event.ctrlKey)) return;
      if (event.altKey || event.shiftKey) return;
      event.preventDefault();
      if (condensed) {
        setSearchOpen(true);
        setSearchFocusToken((token) => token + 1);
        return;
      }
      const input = inFlowSearchRef.current?.querySelector("input");
      input?.focus();
      input?.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [condensed]);
  useEffect(() => {
    if (condensed) return;
    // The fold-out is gone from the chrome; forgetting it open keeps the next condensing
    // from starting with an empty expanded search nobody asked for.
    setSearchOpen(false);
    if (!topbarSearchFocusedRef.current) return;
    topbarSearchFocusedRef.current = false;
    const input = inFlowSearchRef.current?.querySelector("input");
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [condensed]);

  return (
    // Painted flat like the chat column: the inset underneath carries the chrome grain, and a
    // content surface that lets it show reads as a different background than every thread.
    <div className="@container/work-list flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      {/* A closed right panel leaves this column full-width, so the shared header
          reserves native window controls and hosts the controls strip itself: on
          desktop the header is a drag-region, and only a no-drag descendant wins
          clicks from it - a floating sibling loses to app-region hit-testing no
          matter its z-index. While the panel is open, the strip mounts back at
          the route level, whose box spans the panel too, so the toggle keeps one
          fixed top-right anchor. */}
      <WorkspacePageHeader
        electron={isElectron}
        reserveNativeControls={!rightPanelOpen}
        className="relative bg-background"
      >
        {titlebarControls}
        {condensed ? (
          <WorkspaceBreadcrumb ariaLabel={scopeAriaLabel} className="overflow-hidden">
            {/* An expanded search owns the scarce horizontal space. The page title stays
                available to readers while the live filters remain available in both states. */}
            <WorkspaceBreadcrumbItem current className={cn(searchExpanded && "sr-only")}>
              <h1 className="truncate">{title}</h1>
            </WorkspaceBreadcrumbItem>
            {searchExpanded ? null : <WorkspaceBreadcrumbSeparator />}
            <WorkspaceBreadcrumbItem className="shrink gap-1.5">
              {condensedFilters}
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        ) : (
          <WorkspaceBreadcrumb ariaLabel={breadcrumbAriaLabel}>
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">{title}</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        )}
        <div className="min-w-0 flex-1" />
        {condensed ? (
          <div className="flex shrink items-center gap-1.5">
            <ExpandableSearch
              searchInput={searchInput}
              searchValue={searchValue}
              ariaLabel={searchAriaLabel}
              open={searchOpen}
              onOpenChange={setSearchOpen}
              focusToken={searchFocusToken}
              onFocusWithin={(focused) => {
                topbarSearchFocusedRef.current = focused;
              }}
            />
            <WorkItemRefreshControl
              compact
              ariaLabel={refreshAriaLabel}
              refreshing={refreshing}
              onRefresh={onRefresh}
            />
          </div>
        ) : null}
        {rightPanelControl}
      </WorkspacePageHeader>

      <div
        ref={scrollRef}
        className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto"
      >
        {/* The top padding is the shared fade band's height, the same pairing the
            settings page makes: at rest the controls sit fully below the mask, and only
            content actually passing under the chrome fades. */}
        <WorkspacePageContainer width="expanded" className="min-h-full gap-4">
          <div className="flex flex-col gap-3">
            <div ref={inFlowSearchRef} className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 basis-full @lg/work-list:basis-0 @lg/work-list:flex-1">
                {searchInput}
              </div>
              {toolbar}
              {!condensed ? (
                <WorkItemRefreshControl
                  ariaLabel={refreshAriaLabel}
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                />
              ) : null}
            </div>
            {/* Scrolled past this marker, the controls are gone and the title takes over. */}
            <div ref={markerRef} aria-hidden className="-mt-3 h-px w-full" />
          </div>

          {listBody}
        </WorkspacePageContainer>
      </div>
    </div>
  );
}

export function WorkItemRefreshControl({
  compact = false,
  ariaLabel,
  refreshing,
  onRefresh,
}: {
  compact?: boolean;
  ariaLabel: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <Button
      size={compact ? "icon-sm" : "icon"}
      variant={compact ? "ghost" : "outline"}
      aria-label={ariaLabel}
      onClick={onRefresh}
      disabled={refreshing}
    >
      <RefreshIcon size="md" refreshing={refreshing} />
    </Button>
  );
}
