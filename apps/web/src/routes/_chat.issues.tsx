import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  IssueInvolvement,
  IssueRef,
  IssueListFilters,
  IssueListInput,
  IssueListSort,
  IssueListState,
  IssueRepositorySelection,
  ProjectId,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowDownUpIcon,
  AtSignIcon,
  CalendarArrowDownIcon,
  CalendarArrowUpIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleDotIcon,
  ClockIcon,
  ExternalLinkIcon,
  FolderGit2Icon,
  GitBranchIcon,
  LayersIcon,
  MessageSquareIcon,
  PenLineIcon,
  PlusIcon,
  UserRoundCheckIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import {
  collectIssueListFacets,
  groupIssueEntries,
  issueEntriesForQuery,
  issueLinkedWorkForEntry,
  issueListEntryKey,
  issueListSnapshotKey,
  issueQueryControls,
  issueRefForEntry,
  issueRepositoriesWithCursors,
  issueRepositoryForProject,
  issueRepositorySelectionForProject,
  issueSelectionScopeKey,
  mergeIssueListResults,
  normalizeIssueHost,
  normalizeIssuePerson,
  parseIssueQuery,
  planIssueBulkAction,
  type EnvironmentIssueEntry,
  type IssueBulkAction,
  type IssueGroupKey,
  type MergedIssueList,
} from "../components/issue/issue.logic";
import { IssueBulkActionBar } from "../components/issue/IssueBulkActionBar";
import { IssueCreateDialog } from "../components/issue/IssueCreateDialog";
import { IssueDetailPanel } from "../components/issue/IssueDetailPanel";
import { IssueFiltersMenu } from "../components/issue/IssueListFilters";
import {
  issueListPreferences,
  readIssueListPreferences,
  rememberedIssueListFields,
  writeIssueListPreferences,
  type IssueListPreferences,
} from "../components/issue/issueListPreferences";
import { IssueRow } from "../components/issue/IssueRow";
import { IssueWorktreeDialog } from "../components/issue/IssueWorktreeDialog";
import { PanelLayoutControls } from "../components/chat/PanelLayoutControls";
import { PullRequestListEmptyState } from "../components/pullRequest/PullRequestListEmptyState";
import { PullRequestListGhost } from "../components/pullRequest/PullRequestGhosts";
import {
  PullRequestSearchInput,
  type PullRequestFilterOption,
} from "../components/pullRequest/PullRequestListFilters";
import { PullRequestsUnavailableState } from "../components/pullRequest/PullRequestsUnavailableState";
import { ProjectFavicon } from "../components/ProjectFavicon";
import { RightPanelTabs } from "../components/RightPanelTabs";
import { Button } from "../components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { SidebarInset } from "../components/ui/sidebar";
import { Spinner } from "../components/ui/spinner";
import { toastManager } from "../components/ui/toast";
import { useWorkItemListKeyboard } from "../components/workItem/useWorkItemListKeyboard";
import { WorkItemGroupHeader } from "../components/workItem/WorkItemGroupHeader";
import { CompactFilterMenu, WorkItemListColumn } from "../components/workItem/WorkItemListColumn";
import {
  retainVisibleWorkItemSelection,
  selectWorkItemRange,
  toggleWorkItemSelection,
} from "../components/workItem/workItemList.logic";
import { isCommandPaletteOpen } from "../commandPaletteBus";
import { useEscapeToGoBack } from "../hooks/useNavigateBack";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../keybindings";
import { isTerminalFocused } from "../lib/terminalFocus";
import { cn } from "../lib/utils";
import { readLocalApi } from "../localApi";
import { usePanelAnimationSettings, usePanelPresence } from "../panelAnimations";
import {
  ISSUES_PANEL_REF,
  selectActiveRightPanelSurface,
  selectSelectedRightPanelSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
  type IssueSurface,
} from "../rightPanelStore";
import { useAllEnvironmentShellsBootstrapped, useProjects } from "../state/entities";
import { useEnvironments } from "../state/environments";
import {
  clearIssueDraft,
  issueEnvironment,
  readIssueListSnapshot,
  removeRetiredIssueStorage,
  useIssueAuthStatus,
  useIssueCandidates,
  useIssueList,
  writeIssueListSnapshot,
  type IssueListSnapshot,
} from "../state/issues";
import { useDebouncedValue } from "../state/queries";
import { formatEnvironmentQueryError } from "../state/query";
import { primaryServerKeybindingsAtom } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadRouteParams } from "../threadRoutes";

export interface IssuesSearch extends IssueListPreferences {
  readonly q?: string;
  /** Reads the scoped project's repository through another host it is reachable on. */
  readonly host?: string;
  readonly selectedIssue?: number;
  /**
   * Which checkout the selected issue was read through. Absent on older links, which open the
   * issue through the scoped project instead.
   */
  readonly selectedProjectId?: ProjectId;
  readonly selectedEnvironmentId?: EnvironmentId;
  readonly selectedRepository?: string;
  readonly selectedHost?: string;
}

// The filters wear the same glyphs the rows do, so the two read as one vocabulary.
const STATE_OPTIONS = [
  { value: "all", label: "All", Icon: LayersIcon },
  { value: "open", label: "Open", Icon: CircleDotIcon },
  { value: "closed", label: "Closed", Icon: CircleCheckIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<IssueListState>>;

const INVOLVEMENT_OPTIONS = [
  { value: "all", label: "All", Icon: LayersIcon },
  { value: "assigned", label: "Assigned to me", Icon: UserRoundCheckIcon },
  { value: "authored", label: "Authored", Icon: PenLineIcon },
  { value: "mentioned", label: "Mentioned", Icon: AtSignIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<IssueInvolvement>>;

const SORT_OPTIONS = [
  { value: "updated", label: "Recently updated", Icon: ClockIcon },
  { value: "created-desc", label: "Newest", Icon: CalendarArrowDownIcon },
  { value: "created-asc", label: "Oldest", Icon: CalendarArrowUpIcon },
  { value: "comments", label: "Most commented", Icon: MessageSquareIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<IssueListSort>>;

const GROUP_ICONS: Record<IssueGroupKey, LucideIcon> = {
  working: GitBranchIcon,
  assigned: UserRoundCheckIcon,
  others: UsersIcon,
};

/** The scope menu's value for every project; no project key is the bare word. */
const ALL_PROJECTS = "all";
/** Long enough that a keystroke does not become a request, short enough to feel answered. */
const SEARCH_DEBOUNCE_MS = 250;
/** One GitHub page per repository, as the pull request list asks for. */
const PAGE_SIZE = 99;
/** The listing accepts at most this many repositories in one request. */
const MAX_REPOSITORIES_PER_REQUEST = 100;
const EMPTY_PREVIEW_SESSIONS = {};
const EMPTY_PREVIEW_DESKTOP_STATE = {};
const EMPTY_TERMINAL_LABELS = new Map<string, string>();
const EMPTY_PENDING_SURFACES = new Set<string>();
const EMPTY_SELECTION: ReadonlySet<string> = new Set();

function projectKey(project: Pick<EnvironmentProject, "environmentId" | "id">): string {
  return JSON.stringify([project.environmentId, project.id]);
}

function boundedText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : undefined;
}

function searchLabels(raw: unknown): Pick<IssuesSearch, "labels"> | undefined {
  const values = (Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [])
    .flatMap((value) => {
      const label = boundedText(value);
      return label === undefined ? [] : [label];
    })
    .slice(0, 25);
  return values.length === 0 ? undefined : { labels: values };
}

function browserStorage(): Storage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function getShortcutContext() {
  return { terminalFocus: isTerminalFocused(), terminalOpen: false };
}

export const Route = createFileRoute("/_chat/issues")({
  validateSearch: (raw: Record<string, unknown>): IssuesSearch => {
    // A link names what it means; whatever it leaves out comes from the reader's last visit.
    const source: Record<string, unknown> = {
      ...raw,
      ...rememberedIssueListFields(raw, readIssueListPreferences()),
    };
    const author = boundedText(source.author);
    const assignee = boundedText(source.assignee);
    const milestone = boundedText(source.milestone);
    const q = typeof raw.q === "string" && raw.q.trim() ? raw.q.slice(0, 200) : undefined;
    return {
      state: source.state === "closed" || source.state === "all" ? source.state : "open",
      ...(INVOLVEMENT_OPTIONS.some((option) => option.value === source.involvement) &&
      source.involvement !== "all"
        ? { involvement: source.involvement as IssueInvolvement }
        : {}),
      ...(SORT_OPTIONS.some((option) => option.value === source.sort) && source.sort !== "updated"
        ? { sort: source.sort as IssueListSort }
        : {}),
      ...searchLabels(source.labels),
      ...(author ? { author } : {}),
      ...(assignee ? { assignee } : {}),
      ...(milestone ? { milestone } : {}),
      ...(typeof source.projectId === "string" && source.projectId
        ? {
            projectId: source.projectId as ProjectId,
            ...(typeof source.environmentId === "string" && source.environmentId
              ? { environmentId: source.environmentId as EnvironmentId }
              : {}),
          }
        : source.scope === "all"
          ? { scope: "all" as const }
          : {}),
      ...(typeof raw.host === "string" && raw.host
        ? { host: normalizeIssueHost(raw.host).slice(0, 200) }
        : {}),
      ...(q ? { q } : {}),
      ...(typeof raw.selectedIssue === "number" &&
      Number.isSafeInteger(raw.selectedIssue) &&
      raw.selectedIssue > 0
        ? { selectedIssue: raw.selectedIssue }
        : {}),
      ...(typeof raw.selectedProjectId === "string" && raw.selectedProjectId
        ? { selectedProjectId: raw.selectedProjectId as ProjectId }
        : {}),
      ...(typeof raw.selectedEnvironmentId === "string" && raw.selectedEnvironmentId
        ? { selectedEnvironmentId: raw.selectedEnvironmentId as EnvironmentId }
        : {}),
      ...(boundedText(raw.selectedRepository)
        ? { selectedRepository: boundedText(raw.selectedRepository)! }
        : {}),
      ...(typeof raw.selectedHost === "string" && raw.selectedHost
        ? { selectedHost: normalizeIssueHost(raw.selectedHost).slice(0, 200) }
        : {}),
    };
  },
  component: IssuesRouteView,
});

function IssuesRouteView() {
  useEscapeToGoBack();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const involvement = search.involvement ?? "all";
  const sort = search.sort ?? "updated";
  const { environments } = useEnvironments();
  // Until one server has reported, an empty capable set means "not known yet".
  const capabilityKnown = environments.some((environment) => environment.serverConfig !== null);
  const capableEnvironmentIds = useMemo(
    () =>
      new Set(
        environments
          .filter(
            (environment) => environment.serverConfig?.environment.capabilities.issues === true,
          )
          .map((environment) => environment.environmentId),
      ),
    [environments],
  );
  const issuesSupported = capableEnvironmentIds.size > 0;
  const projects = useProjects();
  const projectsReady = useAllEnvironmentShellsBootstrapped();
  const issueProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          capableEnvironmentIds.has(project.environmentId) &&
          issueRepositoryForProject(project) !== null,
      ),
    [capableEnvironmentIds, projects],
  );
  // A named project the workspace no longer has falls back to every project, the way the pull
  // request page treats a stale scope; one that has not arrived yet is not wrong yet.
  const scopedProject = useMemo(
    () =>
      search.projectId === undefined
        ? null
        : (issueProjects.find(
            (project) =>
              project.id === search.projectId &&
              (search.environmentId === undefined ||
                project.environmentId === search.environmentId),
          ) ?? null),
    [issueProjects, search.environmentId, search.projectId],
  );
  const scopePending = search.projectId !== undefined && scopedProject === null && !projectsReady;
  const scopedSelection = useMemo(
    () => issueRepositorySelectionForProject(scopedProject, search.host),
    [scopedProject, search.host],
  );
  // One checkout can be reachable through two hosts (an Enterprise mirror); offered in Filters.
  const scopedRepositoryHosts = useMemo(() => {
    const descriptor = scopedProject === null ? null : issueRepositoryForProject(scopedProject);
    if (descriptor === null) return [];
    return [
      ...new Set(
        issueProjects.flatMap((project) => {
          const candidate = issueRepositoryForProject(project);
          return candidate !== null &&
            candidate.repository.toLowerCase() === descriptor.repository.toLowerCase()
            ? [candidate.host]
            : [];
        }),
      ),
    ].toSorted();
  }, [issueProjects, scopedProject]);

  /** What each server is asked about: the scoped checkout, or every GitHub project it holds. */
  const scopeQueries = useMemo((): ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly repositories: ReadonlyArray<IssueRepositorySelection>;
  }> => {
    if (scopedProject !== null) {
      return scopedSelection === null
        ? []
        : [{ environmentId: scopedProject.environmentId, repositories: [scopedSelection] }];
    }
    if (scopePending) return [];
    const byEnvironment = new Map<EnvironmentId, Map<string, IssueRepositorySelection>>();
    for (const project of issueProjects) {
      const selection = issueRepositorySelectionForProject(project);
      if (selection === null) continue;
      const held = byEnvironment.get(project.environmentId) ?? new Map();
      // Two projects on one server checking out the same repository would list it twice.
      const key = `${selection.host ?? ""}:${selection.repository.toLowerCase()}`;
      if (!held.has(key)) held.set(key, selection);
      byEnvironment.set(project.environmentId, held);
    }
    return [...byEnvironment]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([environmentId, selections]) => ({
        environmentId,
        repositories: [...selections.values()].slice(0, MAX_REPOSITORIES_PER_REQUEST),
      }));
  }, [issueProjects, scopePending, scopedProject, scopedSelection]);
  const scopeKey =
    scopedProject !== null && scopedSelection !== null
      ? issueSelectionScopeKey(scopedProject.environmentId, scopedSelection)
      : ALL_PROJECTS;
  const showRepository =
    scopeQueries.reduce((count, query) => count + query.repositories.length, 0) > 1;

  const updateSearch = useCallback(
    (patch: { [Key in keyof IssuesSearch]?: IssuesSearch[Key] | undefined }) =>
      void navigate({
        // Rebuilt rather than spread so a cleared field leaves the URL instead of lingering.
        search: (previous: IssuesSearch): IssuesSearch => {
          const next = { ...previous, ...patch };
          return {
            ...issueListPreferences({ ...next, state: next.state ?? previous.state }),
            ...(next.q ? { q: next.q } : {}),
            ...(next.host ? { host: next.host } : {}),
            ...(next.selectedIssue ? { selectedIssue: next.selectedIssue } : {}),
            ...(next.selectedProjectId ? { selectedProjectId: next.selectedProjectId } : {}),
            ...(next.selectedEnvironmentId
              ? { selectedEnvironmentId: next.selectedEnvironmentId }
              : {}),
            ...(next.selectedRepository ? { selectedRepository: next.selectedRepository } : {}),
            ...(next.selectedHost ? { selectedHost: next.selectedHost } : {}),
          };
        },
        replace: true,
      }),
    [navigate],
  );
  // List controls change the rows, not the open issue, and become the next visit's defaults.
  const updateListScope = (
    patch: { [Key in keyof IssueListPreferences]?: IssueListPreferences[Key] | undefined } & {
      readonly q?: string | undefined;
      readonly host?: string | undefined;
    },
  ) => {
    writeIssueListPreferences({ ...search, ...patch, state: patch.state ?? search.state });
    updateSearch(patch);
  };

  // Searching asks GitHub, which takes a round trip, so the text is held a moment before it is
  // sent; until it lands, the rows on screen are narrowed locally.
  const typedQuery = (search.q ?? "").trim();
  const sentQuery = useDebouncedValue(typedQuery, SEARCH_DEBOUNCE_MS);
  const querySettled = typedQuery === sentQuery;
  const typedParsed = useMemo(() => parseIssueQuery(typedQuery), [typedQuery]);
  const sentParsed = useMemo(() => parseIssueQuery(sentQuery), [sentQuery]);
  // A typed `is:closed` or `sort:comments` is a word about the page's own controls; once the
  // text settles it moves onto them, rather than fighting the state and sort the request sends.
  const typedControls = useMemo(
    () => (querySettled ? issueQueryControls(sentQuery) : null),
    [querySettled, sentQuery],
  );
  const applyTypedControls = useEffectEvent(
    (controls: NonNullable<ReturnType<typeof issueQueryControls>>) =>
      updateListScope({
        q: controls.query || undefined,
        ...(controls.state === undefined ? {} : { state: controls.state }),
        ...(controls.sort === undefined ? {} : { sort: controls.sort }),
      }),
  );
  useEffect(() => {
    if (typedControls !== null) applyTypedControls(typedControls);
  }, [typedControls]);
  const menuFilters = useMemo(
    (): IssueListFilters => ({
      ...(search.labels ? { labels: [search.labels.slice(0, 25)] } : {}),
      ...(search.author ? { author: normalizeIssuePerson(search.author) } : {}),
      ...(search.assignee ? { assignee: normalizeIssuePerson(search.assignee) } : {}),
      ...(search.milestone ? { milestone: search.milestone } : {}),
    }),
    [search.assignee, search.author, search.labels, search.milestone],
  );
  const menuFiltered = Object.keys(menuFilters).length > 0;
  // A typed qualifier is the more recent word on the same thing, so it wins over the menu's.
  const filters = useMemo(
    (): IssueListFilters => ({ ...menuFilters, ...sentParsed.filters }),
    [menuFilters, sentParsed.filters],
  );
  const hasFilters = Object.keys(filters).length > 0;
  const carryKey = JSON.stringify([scopeKey, search.state, involvement, sort, filters]);
  const listKey = issueListSnapshotKey({
    scope: scopeKey,
    state: search.state,
    involvement,
    sort,
    filters,
    query: sentParsed.text,
  });

  // Each "load more" appends one step of per-server cursors; a new question starts again.
  const [page, setPage] = useState<{
    readonly key: string;
    readonly steps: ReadonlyArray<ReadonlyMap<EnvironmentId, Readonly<Record<string, string>>>>;
  }>({ key: listKey, steps: [] });
  const steps = page.key === listKey ? page.steps : [];
  useEffect(() => {
    setPage({ key: listKey, steps: [] });
  }, [listKey]);
  const listTargets = useMemo(() => {
    const input = {
      state: search.state,
      limit: PAGE_SIZE,
      ...(involvement === "all" ? {} : { involvement }),
      ...(sort === "updated" ? {} : { sort }),
      ...(hasFilters ? { filters } : {}),
      ...(sentParsed.text ? { query: sentParsed.text } : {}),
    } satisfies IssueListInput;
    const repositoryField = (repositories: ReadonlyArray<IssueRepositorySelection>) =>
      repositories.length === 1 ? { repository: repositories[0]! } : { repositories };
    return [
      ...scopeQueries.map(({ environmentId, repositories }) => ({
        environmentId,
        input: { ...input, ...repositoryField(repositories) } satisfies IssueListInput,
      })),
      // A continuation only asks the servers, and the repositories, that said there was more.
      ...steps.flatMap((step) =>
        scopeQueries.flatMap(({ environmentId, repositories }) => {
          const cursors = step.get(environmentId);
          if (cursors === undefined) return [];
          return [
            {
              environmentId,
              input: {
                ...input,
                ...repositoryField(issueRepositoriesWithCursors(repositories, cursors)),
                cursors,
              } satisfies IssueListInput,
            },
          ];
        }),
      ),
    ];
  }, [filters, hasFilters, involvement, scopeQueries, search.state, sentParsed.text, sort, steps]);
  const listQuery = useIssueList(listTargets, sort);

  // Whose issues are "yours": the account the scoped (or first) server is signed in with.
  const authTarget = useMemo(() => {
    const environmentId = scopedProject?.environmentId ?? scopeQueries[0]?.environmentId;
    if (environmentId === undefined) return null;
    const host =
      scopedSelection?.host ??
      scopeQueries.find((query) => query.environmentId === environmentId)?.repositories[0]?.host ??
      "github.com";
    return { environmentId, input: { provider: "github" as const, host } };
  }, [scopeQueries, scopedProject, scopedSelection]);
  const authQuery = useIssueAuthStatus(authTarget);
  const viewerLogin = authQuery.data?.account ?? null;

  // The last good answer for exactly this question, kept across reloads, so a cold start or a
  // failed refresh still shows rows rather than nothing.
  const [snapshot, setSnapshot] = useState<{
    readonly key: string;
    readonly value: IssueListSnapshot | null;
  }>(() => ({ key: listKey, value: readIssueListSnapshot(browserStorage(), listKey) }));
  // A new question reads its own snapshot in the same render, so it never flashes empty first.
  const snapshotValue = useMemo(
    () =>
      snapshot.key === listKey ? snapshot.value : readIssueListSnapshot(browserStorage(), listKey),
    [listKey, snapshot],
  );
  useEffect(() => {
    removeRetiredIssueStorage(browserStorage());
  }, []);
  // The whole cache is rewritten on each save, so an answer identical to the last one saved for
  // the same question is not saved again.
  const lastSavedRef = useRef<string | null>(null);
  useEffect(() => {
    if (listQuery.isPending || listQuery.error !== null || listQuery.values.length === 0) return;
    const data = listQuery.data;
    // A partial failure is still worth keeping unless it is all failure.
    if (data === null || (data.entries.length === 0 && data.errors.length > 0)) return;
    const saved = JSON.stringify([listKey, listQuery.values]);
    if (saved === lastSavedRef.current) return;
    lastSavedRef.current = saved;
    const value = writeIssueListSnapshot(browserStorage(), listKey, listQuery.values);
    setSnapshot({ key: listKey, value });
  }, [listKey, listQuery.data, listQuery.error, listQuery.isPending, listQuery.values]);
  const snapshotData = useMemo(
    () => (snapshotValue === null ? null : mergeIssueListResults(snapshotValue.results, sort)),
    [snapshotValue, sort],
  );
  // Rows for the question before this one, held while only the search text changed, so typing
  // narrows what is on screen instead of blanking it for every round trip.
  const [held, setHeld] = useState<{ readonly key: string; readonly data: MergedIssueList } | null>(
    null,
  );
  useEffect(() => {
    if (listQuery.data !== null && !listQuery.isPending)
      setHeld({ key: carryKey, data: listQuery.data });
  }, [carryKey, listQuery.data, listQuery.isPending]);

  const live = listQuery.data;
  const failedOutright =
    listQuery.error !== null ||
    (live !== null && live.entries.length === 0 && live.errors.length > 0);
  const errorText = listQuery.error ?? live?.errors[0]?.message ?? null;
  const stale = failedOutright && snapshotData !== null;
  const carried = held?.key === carryKey ? held.data : null;
  const data = stale ? snapshotData : (live ?? snapshotData ?? carried);
  const showingCarried = live === null && snapshotData === null && carried !== null;
  const firstLoad = listQuery.isPending && data === null;
  const refreshing = listQuery.isPending && data !== null;

  const entries = useMemo(() => {
    const rows = data?.entries ?? [];
    // GitHub searches more than a row shows, so once its answer is in it is not narrowed again.
    if (typedParsed.text.length === 0 || (querySettled && !showingCarried && !stale)) return rows;
    return issueEntriesForQuery(rows, typedParsed.text);
  }, [data, querySettled, showingCarried, stale, typedParsed.text]);
  const groups = useMemo(
    () => groupIssueEntries(entries, involvement, viewerLogin),
    [entries, involvement, viewerLogin],
  );
  const orderedEntries = useMemo(() => groups.flatMap((group) => group.entries), [groups]);
  const orderedKeys = useMemo(() => orderedEntries.map(issueListEntryKey), [orderedEntries]);
  const shownCount = orderedEntries.length;

  // Facets for the Filters menu and the bulk pickers: the loaded rows plus, once the menu is
  // open on one project, that repository's own labels.
  const facets = useMemo(() => collectIssueListFacets(data?.entries ?? []), [data?.entries]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [bulkPickerOpen, setBulkPickerOpen] = useState(false);
  const candidateSelection = scopedSelection ?? scopeQueries[0]?.repositories[0] ?? null;
  const candidateEnvironmentId = scopedProject?.environmentId ?? scopeQueries[0]?.environmentId;
  const labelCandidates = useIssueCandidates(
    (filtersOpen || bulkPickerOpen) && candidateSelection !== null && candidateEnvironmentId
      ? {
          environmentId: candidateEnvironmentId,
          input: { ...candidateSelection, kind: "labels", limit: 100 },
        }
      : null,
  );
  const assigneeCandidates = useIssueCandidates(
    bulkPickerOpen && candidateSelection !== null && candidateEnvironmentId
      ? {
          environmentId: candidateEnvironmentId,
          input: { ...candidateSelection, kind: "assignees", limit: 100 },
        }
      : null,
  );
  const labelOptions = useMemo(() => {
    const known = new Set(facets.labels.map((label) => label.name.toLowerCase()));
    const candidates =
      labelCandidates.data?._tag === "labels" ? labelCandidates.data.candidates : [];
    return [
      ...facets.labels,
      ...candidates
        .filter((candidate) => !known.has(candidate.name.toLowerCase()))
        .map((candidate) => ({ name: candidate.name, color: candidate.color, count: 0 })),
    ];
  }, [facets.labels, labelCandidates.data]);
  const assigneeOptions = useMemo(() => {
    const people = [...facets.assignees, ...facets.authors];
    if (assigneeCandidates.data?._tag === "assignees") {
      people.push(...assigneeCandidates.data.candidates.map((actor) => ({ actor, count: 0 })));
    }
    const seen = new Set<string>();
    return people.filter((facet) => {
      const key = facet.actor.login.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [assigneeCandidates.data, facets.assignees, facets.authors]);

  const loadMore = () => {
    if (listQuery.isPending || live === null || live.nextCursorsByEnvironment.size === 0) return;
    setPage({ key: listKey, steps: [...steps, live.nextCursorsByEnvironment] });
  };
  const canLoadMore = !stale && !showingCarried && (live?.nextCursorsByEnvironment.size ?? 0) > 0;
  const refresh = () => {
    listQuery.refresh();
    authQuery.refresh();
  };

  // Right panel: one tab strip for the page, the issues it has opened.
  const rightPanelState = useRightPanelStore((state) =>
    selectThreadRightPanelState(state.byThreadKey, ISSUES_PANEL_REF),
  );
  const selectedSurface = useRightPanelStore((state) =>
    selectSelectedRightPanelSurface(state.byThreadKey, ISSUES_PANEL_REF),
  );
  const selectedIssueSurface = selectedSurface?.kind === "issue" ? selectedSurface : null;
  const activeSurface = rightPanelState.isOpen ? selectedIssueSurface : null;
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  const rightPanelPresenceValue = useMemo(
    () => ({ activeSurface: selectedIssueSurface, surfaces: rightPanelState.surfaces }),
    [rightPanelState.surfaces, selectedIssueSurface],
  );
  const rightPanelPresence = usePanelPresence(
    rightPanelState.isOpen && selectedIssueSurface !== null,
    rightPanelPresenceValue,
    panelAnimationsActive,
    ISSUES_PANEL_REF.threadId,
    panelAnimationDurationMs,
  );
  const rightPanelPresent = rightPanelPresence.present;
  const renderedIssueSurface = rightPanelPresence.value?.activeSurface ?? null;
  const renderedRightPanelSurfaces = rightPanelPresence.value?.surfaces ?? [];
  const rightPanelAvailable = selectedIssueSurface !== null;

  const openIssueReference = useCallback(
    (environmentId: EnvironmentId, issue: IssueRef & { readonly url?: string }) => {
      useRightPanelStore.getState().openIssue(ISSUES_PANEL_REF, {
        environmentId,
        projectId: issue.projectId,
        ...(issue.host === undefined ? {} : { host: issue.host }),
        repository: issue.repository,
        number: issue.number,
        ...(issue.url === undefined ? {} : { url: issue.url }),
      });
      updateSearch({
        selectedIssue: issue.number,
        selectedProjectId: issue.projectId,
        selectedEnvironmentId: environmentId,
        selectedRepository: issue.repository,
        selectedHost: issue.host,
      });
    },
    [updateSearch],
  );
  const openIssue = useCallback(
    (entry: EnvironmentIssueEntry) =>
      openIssueReference(entry.environmentId, { ...issueRefForEntry(entry), url: entry.url }),
    [openIssueReference],
  );
  // A link to one issue opens it in the panel through the checkout it names, or the scoped one.
  const linkedProject = useMemo(() => {
    if (search.selectedIssue === undefined) return null;
    if (search.selectedProjectId === undefined) return scopedProject;
    return (
      issueProjects.find(
        (project) =>
          project.id === search.selectedProjectId &&
          (search.selectedEnvironmentId === undefined ||
            project.environmentId === search.selectedEnvironmentId),
      ) ?? null
    );
  }, [
    issueProjects,
    scopedProject,
    search.selectedEnvironmentId,
    search.selectedIssue,
    search.selectedProjectId,
  ]);
  const linkedDescriptor = linkedProject === null ? null : issueRepositoryForProject(linkedProject);
  const linkedEnvironmentId = linkedProject?.environmentId;
  const linkedProjectId = linkedProject?.id;
  const linkedRepository = search.selectedRepository ?? linkedDescriptor?.repository;
  const linkedHost = search.selectedHost ?? search.host ?? linkedDescriptor?.host;
  useEffect(() => {
    if (
      search.selectedIssue === undefined ||
      linkedEnvironmentId === undefined ||
      linkedProjectId === undefined ||
      linkedRepository === undefined
    ) {
      return;
    }
    useRightPanelStore.getState().openIssue(ISSUES_PANEL_REF, {
      environmentId: linkedEnvironmentId,
      projectId: linkedProjectId,
      ...(linkedHost ? { host: linkedHost } : {}),
      repository: linkedRepository,
      number: search.selectedIssue,
    });
  }, [linkedEnvironmentId, linkedHost, linkedProjectId, linkedRepository, search.selectedIssue]);

  const panelEnvironmentId =
    (renderedIssueSurface?.environmentId as EnvironmentId | undefined) ??
    linkedEnvironmentId ??
    null;
  const clearedSelection = {
    selectedIssue: undefined,
    selectedProjectId: undefined,
    selectedEnvironmentId: undefined,
    selectedRepository: undefined,
    selectedHost: undefined,
  };
  const selectSurfaceInUrl = (surface: IssueSurface | null) =>
    updateSearch(
      surface === null
        ? clearedSelection
        : {
            selectedIssue: surface.number,
            selectedProjectId: surface.projectId as ProjectId,
            selectedEnvironmentId: surface.environmentId as EnvironmentId | undefined,
            selectedRepository: surface.repository,
            selectedHost: surface.host,
          },
    );
  const closeSurface = (surface: IssueSurface) => {
    useRightPanelStore.getState().closeSurface(ISSUES_PANEL_REF, surface.id);
    const next = selectActiveRightPanelSurface(
      useRightPanelStore.getState().byThreadKey,
      ISSUES_PANEL_REF,
    );
    selectSurfaceInUrl(next?.kind === "issue" ? next : null);
  };
  const toggleRightPanel = () => {
    if (rightPanelState.isOpen) {
      useRightPanelStore.getState().close(ISSUES_PANEL_REF);
      selectSurfaceInUrl(null);
    } else if (selectedIssueSurface !== null) {
      useRightPanelStore.getState().show(ISSUES_PANEL_REF);
      selectSurfaceInUrl(selectedIssueSurface);
    }
  };
  // This page has no ChatView, so it handles the shared panel shortcuts itself.
  const closeActiveSurfaceFromShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (activeSurface === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) closeSurface(activeSurface);
  });
  const toggleRightPanelFromShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!rightPanelAvailable) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) toggleRightPanel();
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isCommandPaletteOpen()) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: getShortcutContext(),
      });
      if (command === "rightPanel.close") closeActiveSurfaceFromShortcut(event);
      if (command === "rightPanel.toggle") toggleRightPanelFromShortcut(event);
    };
    // Let panel shortcuts consume Escape before page navigation at window.
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [keybindings]);

  // GitHub sign-in, for hosts whose CLI is not authenticated yet.
  const authStart = useAtomCommand(issueEnvironment.authStart, { reportFailure: false });
  const [authError, setAuthError] = useState<string | null>(null);
  const [authPending, setAuthPending] = useState(false);
  const startAuth = async () => {
    if (authPending || authTarget === null) return;
    setAuthPending(true);
    setAuthError(null);
    try {
      const result = await authStart(authTarget);
      if (result._tag === "Success") {
        authQuery.refresh();
        if (result.value.authorizationUrl)
          void readLocalApi()?.shell.openExternal(result.value.authorizationUrl);
      } else {
        setAuthError("Could not start GitHub authentication. Try again.");
      }
    } catch {
      setAuthError("Could not start GitHub authentication. Try again.");
    } finally {
      setAuthPending(false);
    }
  };
  const unavailable =
    !stale &&
    errorText !== null &&
    failedOutright &&
    /(required|unavailable|unsupported|missing|cannot be browsed)/iu.test(errorText);
  const unauthenticated =
    !stale &&
    (authQuery.data?.status === "unauthenticated" ||
      (errorText !== null &&
        failedOutright &&
        /not authenticated|unauthenticated/iu.test(errorText)));

  // Bulk selection. Hidden rows drop out of it, so an action never reaches what is not shown.
  const [checkedKeys, setCheckedKeys] = useState<ReadonlySet<string>>(EMPTY_SELECTION);
  const checked = retainVisibleWorkItemSelection(checkedKeys, orderedKeys);
  const anchorRef = useRef<string | null>(null);
  const orderedKeysRef = useRef(orderedKeys);
  useEffect(() => {
    orderedKeysRef.current = orderedKeys;
  }, [orderedKeys]);
  const toggleSelect = useCallback((entry: EnvironmentIssueEntry, range: boolean) => {
    const key = issueListEntryKey(entry);
    setCheckedKeys((current) =>
      range
        ? selectWorkItemRange(orderedKeysRef.current, anchorRef.current, key, current)
        : toggleWorkItemSelection(current, key),
    );
    anchorRef.current = key;
  }, []);
  const clearSelection = () => {
    if (checked.size === 0) return false;
    setCheckedKeys(EMPTY_SELECTION);
    anchorRef.current = null;
    return true;
  };
  const closeIssue = useAtomCommand(issueEnvironment.close, { reportFailure: false });
  const reopenIssue = useAtomCommand(issueEnvironment.reopen, { reportFailure: false });
  const updateIssue = useAtomCommand(issueEnvironment.update, { reportFailure: false });
  const [bulkRunning, setBulkRunning] = useState(false);
  const checkedEntries = orderedEntries.filter((entry) => checked.has(issueListEntryKey(entry)));
  const runBulkAction = async (action: IssueBulkAction) => {
    if (bulkRunning || stale || showingCarried) return;
    const plan = planIssueBulkAction(checkedEntries, action);
    const [doing, done] =
      action.kind === "close"
        ? ["Closing", "Closed"]
        : action.kind === "reopen"
          ? ["Reopening", "Reopened"]
          : action.kind === "add-label"
            ? [`Labeling “${action.label}” on`, `Labeled “${action.label}” on`]
            : [`Assigning @${action.login} to`, `Assigned @${action.login} to`];
    if (plan.length === 0) {
      toastManager.add({
        type: "info",
        title: "Nothing to change",
        description: "Every selected issue already matches.",
      });
      return;
    }
    setBulkRunning(true);
    const noun = (count: number) => `${count} issue${count === 1 ? "" : "s"}`;
    const toastId = toastManager.add({
      type: "loading",
      title: `${doing} ${noun(plan.length)}`,
      description: `0 of ${plan.length} done`,
      timeout: 0,
    });
    const failures: Array<{ readonly entry: EnvironmentIssueEntry; readonly message: string }> = [];
    // One at a time: GitHub rate-limits bursts of writes, and a per-issue report needs order.
    for (const [index, step] of plan.entries()) {
      const target = { environmentId: step.entry.environmentId };
      const result =
        step.command === "close"
          ? await closeIssue({ ...target, input: step.input })
          : step.command === "reopen"
            ? await reopenIssue({ ...target, input: step.input })
            : await updateIssue({ ...target, input: step.input });
      if (result._tag === "Failure") {
        failures.push({ entry: step.entry, message: formatEnvironmentQueryError(result.cause) });
      }
      toastManager.update(toastId, {
        type: "loading",
        title: `${doing} ${noun(plan.length)}`,
        description: `${index + 1} of ${plan.length} done`,
        timeout: 0,
      });
    }
    const succeeded = plan.length - failures.length;
    toastManager.update(
      toastId,
      failures.length === 0
        ? { type: "success", title: `${done} ${noun(succeeded)}`, timeout: 5_000 }
        : {
            type: "error",
            title: `${done} ${succeeded} of ${noun(plan.length)}`,
            description: failures
              .map(({ entry, message }) => `#${entry.number} ${entry.repository}: ${message}`)
              .join("\n"),
            timeout: 0,
          },
    );
    // What failed stays selected, ready for another try; the rest leave the selection.
    setCheckedKeys(new Set(failures.map(({ entry }) => issueListEntryKey(entry))));
    setBulkRunning(false);
    listQuery.refresh();
  };

  // Starting work and creating issues.
  const [worktreeTarget, setWorktreeTarget] = useState<EnvironmentIssueEntry | null>(null);
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  const workOn = useCallback(
    (entry: EnvironmentIssueEntry) => {
      setWorktreeTarget(entry);
      setWorktreeOpen(true);
    },
    [setWorktreeOpen, setWorktreeTarget],
  );
  const openThread = useCallback(
    (entry: EnvironmentIssueEntry) => {
      if (!entry.linkedWork) return;
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(
          scopeThreadRef(entry.environmentId, entry.linkedWork.threadId),
        ),
      });
    },
    [navigate],
  );
  const [createTarget, setCreateTarget] = useState<EnvironmentProject | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newIssueMenuOpen, setNewIssueMenuOpen] = useState(false);
  const createSelection = useMemo(
    () =>
      createTarget === null
        ? null
        : createTarget === scopedProject
          ? scopedSelection
          : issueRepositorySelectionForProject(createTarget),
    [createTarget, scopedProject, scopedSelection],
  );
  const startCreate = (project: EnvironmentProject) => {
    setCreateTarget(project);
    setCreateOpen(true);
  };
  const newIssue = () => {
    if (scopedProject !== null) startCreate(scopedProject);
    else if (issueProjects.length === 1) startCreate(issueProjects[0]!);
    else if (issueProjects.length > 1) setNewIssueMenuOpen(true);
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  // j/k walk the rows, Enter opens one, x checks it, c starts a new issue.
  useWorkItemListKeyboard({
    listRef: scrollRef,
    enabled: issuesSupported,
    onToggle: (key) => {
      const entry = orderedEntries.find((candidate) => issueListEntryKey(candidate) === key);
      if (entry) toggleSelect(entry, false);
    },
    onCreate: newIssue,
    onSelectAll: () => setCheckedKeys(new Set(orderedKeys)),
    onClearSelection: clearSelection,
  });

  const projectOptions: ReadonlyArray<PullRequestFilterOption<string>> = [
    { value: ALL_PROJECTS, label: "All projects", Icon: LayersIcon },
    ...issueProjects.map((project) => ({
      value: projectKey(project),
      label: project.title,
      Icon: FolderGit2Icon,
      project,
    })),
  ];
  const projectValue = scopedProject === null ? ALL_PROJECTS : projectKey(scopedProject);
  const changeScope = (value: string) => {
    const project = issueProjects.find((candidate) => projectKey(candidate) === value);
    updateListScope(
      project === undefined
        ? { scope: "all", projectId: undefined, environmentId: undefined, host: undefined }
        : {
            scope: undefined,
            projectId: project.id,
            environmentId: project.environmentId,
            host: undefined,
          },
    );
  };

  const searchInput = (
    <PullRequestSearchInput
      value={search.q ?? ""}
      busy={typedQuery.length > 0 && (!querySettled || showingCarried)}
      onChange={(query) => updateListScope({ q: query || undefined })}
      placeholder="Search issues, or label:bug assignee:me"
      ariaLabel="Search issues"
    />
  );
  const sortMenu = (
    <CompactFilterMenu
      label="Sort issues"
      triggerIcon={<ArrowDownUpIcon aria-hidden className="size-4" />}
      triggerLabel="Sort"
      outlined
      value={sort}
      options={SORT_OPTIONS}
      onChange={(next) => updateListScope({ sort: next })}
    />
  );
  const filtersMenu = (
    <IssueFiltersMenu
      onOpenChange={setFiltersOpen}
      state={search.state}
      stateOptions={STATE_OPTIONS}
      onState={(state) => updateListScope({ state })}
      involvement={involvement}
      involvementOptions={INVOLVEMENT_OPTIONS}
      onInvolvement={(next) => updateListScope({ involvement: next })}
      filters={menuFilters}
      onFilters={(next) =>
        updateListScope({
          labels: next.labels?.flatMap((group) => group),
          author: next.author,
          assignee: next.assignee,
          milestone: next.milestone,
        })
      }
      authorOptions={facets.authors}
      assigneeOptions={facets.assignees}
      labelOptions={labelOptions}
      milestoneOptions={facets.milestones}
      host={scopedSelection?.host}
      hostOptions={scopedRepositoryHosts}
      onHost={(host) => updateListScope({ host })}
    />
  );
  const newIssueButton =
    scopedProject !== null || issueProjects.length <= 1 ? (
      <Button
        onClick={newIssue}
        disabled={issueProjects.length === 0 || scopePending}
        aria-keyshortcuts="c"
      >
        <PlusIcon aria-hidden className="size-4" />
        New issue
      </Button>
    ) : (
      <Menu open={newIssueMenuOpen} onOpenChange={setNewIssueMenuOpen}>
        <MenuTrigger render={<Button aria-keyshortcuts="c" />}>
          <PlusIcon aria-hidden className="size-4" />
          New issue
          <ChevronDownIcon aria-hidden className="size-3.5" />
        </MenuTrigger>
        <MenuPopup align="end" side="bottom">
          {issueProjects.map((project) => (
            <MenuItem key={projectKey(project)} onClick={() => startCreate(project)}>
              <ProjectFavicon project={project} className="size-3.5" />
              <span className="min-w-0 flex-1 truncate">{project.title}</span>
              <span className="text-xs text-muted-foreground">
                {issueRepositoryForProject(project)?.repository}
              </span>
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    );
  const toolbar = (
    <>
      {sortMenu}
      {filtersMenu}
      <CompactFilterMenu
        label="Project"
        outlined
        value={projectValue}
        options={projectOptions}
        onChange={changeScope}
        className="max-w-56"
      />
      {newIssueButton}
    </>
  );
  const condensedFilters = (
    <>
      <CompactFilterMenu
        label="Filter by state"
        value={search.state}
        options={STATE_OPTIONS}
        onChange={(state) => updateListScope({ state })}
        className="shrink-0"
      />
      <CompactFilterMenu
        label="Filter by involvement"
        value={involvement}
        options={INVOLVEMENT_OPTIONS}
        onChange={(next) => updateListScope({ involvement: next })}
      />
      <CompactFilterMenu
        label="Project"
        value={projectValue}
        options={projectOptions}
        onChange={changeScope}
      />
    </>
  );

  // Nothing typed and only carried rows that narrowed to nothing is not an answer yet.
  const carriedToNothing = showingCarried && listQuery.isPending && shownCount === 0;
  const partialErrors = !failedOutright && (live?.errors.length ?? 0) > 0 ? live!.errors : [];
  const listBody = (
    <>
      {!capabilityKnown ? (
        <PullRequestListGhost rows={7} label="Loading issues" diffStat={false} />
      ) : !issuesSupported ? (
        <PullRequestsUnavailableState
          title="Issues unavailable"
          error="Update your T3 Code servers to browse GitHub issues."
          Icon={CircleDotIcon}
        />
      ) : !projectsReady && issueProjects.length === 0 ? (
        <PullRequestListGhost rows={7} label="Loading projects" diffStat={false} />
      ) : issueProjects.length === 0 ? (
        <PullRequestsUnavailableState
          title="No GitHub projects"
          error="Add a project with a GitHub remote to browse its issues here."
          Icon={CircleDotIcon}
        />
      ) : unavailable ? (
        <PullRequestsUnavailableState
          title="GitHub Issues unavailable"
          error={errorText ?? "GitHub Issues are unavailable for this environment."}
          refreshing={listQuery.isPending}
          onRetry={refresh}
          Icon={CircleDotIcon}
        />
      ) : unauthenticated ? (
        <AuthState
          detail={authError ?? authQuery.data?.detail ?? errorText}
          authorizationUrl={authQuery.data?.authorizationUrl ?? null}
          userCode={authQuery.data?.userCode ?? null}
          pending={authPending}
          onAuthenticate={startAuth}
        />
      ) : firstLoad || scopePending || carriedToNothing ? (
        <PullRequestListGhost rows={7} label="Loading issues" diffStat={false} />
      ) : failedOutright && shownCount === 0 ? (
        <PullRequestsUnavailableState
          title="Could not load issues"
          error={errorText ?? "GitHub did not return an issue list."}
          refreshing={listQuery.isPending}
          onRetry={refresh}
          Icon={CircleDotIcon}
        />
      ) : shownCount === 0 ? (
        <PullRequestListEmptyState
          noun="issues"
          hasProjects
          refreshing={refreshing}
          onRefresh={refresh}
          query={typedQuery}
          filtered={
            menuFiltered ||
            search.state !== "open" ||
            involvement !== "all" ||
            scopedProject !== null
          }
          searching={typedQuery.length > 0 && (!querySettled || showingCarried)}
          canLoadMore={canLoadMore}
          loadingMore={refreshing}
          onClearQuery={() => updateListScope({ q: undefined })}
          onLoadMore={loadMore}
        />
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.key} className="space-y-0.5">
              {group.label ? (
                <WorkItemGroupHeader
                  icon={GROUP_ICONS[group.key]}
                  label={group.label}
                  count={group.entries.length}
                />
              ) : null}
              {group.entries.map((entry) => {
                const key = issueListEntryKey(entry);
                return (
                  <IssueRow
                    key={key}
                    entry={entry}
                    selected={
                      activeSurface?.kind === "issue" &&
                      activeSurface.number === entry.number &&
                      activeSurface.repository.toLowerCase() === entry.repository.toLowerCase() &&
                      (activeSurface.environmentId === undefined ||
                        activeSurface.environmentId === entry.environmentId)
                    }
                    checked={checked.has(key)}
                    selectionActive={checked.size > 0}
                    showRepository={showRepository}
                    onOpen={openIssue}
                    onToggleSelect={toggleSelect}
                    onWorkOn={workOn}
                    onOpenThread={openThread}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}

      {stale ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-surface px-3 py-2 text-xs">
          <span className="min-w-0">
            {errorText ?? "Refresh failed."} Showing the issues saved{" "}
            {snapshotValue ? new Date(snapshotValue.savedAt).toLocaleString() : "earlier"}.
          </span>
          <Button size="xs" variant="outline" onClick={refresh} disabled={listQuery.isPending}>
            Retry
          </Button>
        </div>
      ) : partialErrors.length > 0 && shownCount > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-surface px-3 py-2 text-xs">
          <span className="min-w-0">
            Could not read {partialErrors.map((error) => error.repository).join(", ")}.{" "}
            {partialErrors[0]?.message}
          </span>
          <Button size="xs" variant="outline" onClick={refresh} disabled={listQuery.isPending}>
            Retry
          </Button>
        </div>
      ) : null}
      {data !== null && data.truncatedEnvironments.length > 0 && shownCount > 0 ? (
        <div className="flex justify-center py-3 text-xs text-muted-foreground">
          {refreshing && steps.length > 0 ? (
            <span className="flex items-center gap-2">
              <Spinner aria-hidden size="sm" />
              Loading more
            </span>
          ) : canLoadMore ? (
            <Button size="sm" variant="outline" onClick={loadMore} disabled={listQuery.isPending}>
              Load more issues
            </Button>
          ) : (
            <span>Narrow your search to find more issues.</span>
          )}
        </div>
      ) : null}
      {checked.size > 0 ? (
        <IssueBulkActionBar
          count={checked.size}
          canClose={checkedEntries.some((entry) => entry.state === "open")}
          canReopen={checkedEntries.some((entry) => entry.state === "closed")}
          running={bulkRunning}
          // Saved or carried rows may no longer say what is on GitHub; acting on them could
          // close what was reopened, so the bar waits for a live answer.
          outdated={stale || showingCarried}
          labelOptions={labelOptions}
          assigneeOptions={assigneeOptions}
          onPickerOpenChange={setBulkPickerOpen}
          onAction={(action) => void runBulkAction(action)}
          onClear={clearSelection}
        />
      ) : null}
    </>
  );

  const panelToggleControls = (
    <PanelLayoutControls
      showTerminalControl={false}
      showThreadPanelControl={false}
      terminalAvailable={false}
      terminalOpen={false}
      terminalShortcutLabel={null}
      threadPanelOpen={false}
      threadPanelPresentation="inline"
      threadPanelShortcutLabel={null}
      threadPanelHasAttention={false}
      onToggleThreadPanel={() => undefined}
      rightPanelAvailable={rightPanelAvailable}
      rightPanelOpen={rightPanelState.isOpen}
      rightPanelShortcutLabel={shortcutLabelForCommand(keybindings, "rightPanel.toggle")}
      rightPanelUnavailableLabel="Select an issue first"
      onToggleTerminal={() => undefined}
      onToggleRightPanel={toggleRightPanel}
    />
  );
  const openPanelControls = (
    <div
      // The same titlebar anchor the pull request page and thread view use.
      className="absolute top-[var(--workspace-controls-top)] right-[var(--workspace-controls-right)] z-50 mr-px flex h-[var(--workspace-topbar-height)] items-center gap-1 [-webkit-app-region:no-drag]"
      data-workspace-titlebar-controls
    >
      {panelToggleControls}
    </div>
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="relative flex min-h-0 flex-1">
        {issuesSupported && rightPanelPresent ? openPanelControls : null}
        <WorkItemListColumn
          title="Issues"
          scopeAriaLabel="Issue scope"
          breadcrumbAriaLabel="Issues breadcrumb"
          searchAriaLabel="Search issues"
          refreshAriaLabel="Refresh issues"
          refreshing={refreshing}
          onRefresh={refresh}
          searchValue={search.q ?? ""}
          searchInput={searchInput}
          condensedFilters={condensedFilters}
          toolbar={toolbar}
          rightPanelControl={
            // Footprint reserve while the panel is closed, as on the pull request page: the
            // toggle keeps one fixed titlebar inset and refresh never slides beneath it.
            !issuesSupported ? null : (
              <span
                aria-hidden
                className={cn(
                  "shrink-0",
                  rightPanelState.isOpen ? "-ml-3 w-0" : "w-7 sm:w-5",
                  panelAnimationsActive && "transition-[width,margin] ease-out",
                )}
                style={
                  panelAnimationsActive
                    ? { transitionDuration: `${panelAnimationDurationMs}ms` }
                    : undefined
                }
              />
            )
          }
          titlebarControls={
            // Inside the header while the panel is closed, where a no-drag descendant wins
            // clicks from the desktop drag region; the route hosts it while the panel is open.
            issuesSupported ? (
              rightPanelPresent ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 left-full w-7 [-webkit-app-region:no-drag]"
                />
              ) : (
                openPanelControls
              )
            ) : null
          }
          rightPanelOpen={rightPanelState.isOpen}
          listBody={listBody}
          scrollRef={scrollRef}
        />

        {rightPanelPresent && renderedIssueSurface && panelEnvironmentId !== null ? (
          <RightPanelTabs
            mode="inline"
            open={rightPanelState.isOpen}
            widthStorageKey="t3code:work-item-panel-width"
            defaultWidth={typeof window === "undefined" ? 640 : Math.floor(window.innerWidth / 2)}
            surfaces={renderedRightPanelSurfaces}
            environmentId={panelEnvironmentId}
            activeSurfaceId={renderedIssueSurface.id}
            pendingSurfaceIds={EMPTY_PENDING_SURFACES}
            previewSessions={EMPTY_PREVIEW_SESSIONS}
            desktopByTabId={EMPTY_PREVIEW_DESKTOP_STATE}
            terminalLabelsById={EMPTY_TERMINAL_LABELS}
            onActivate={(surface) => {
              if (surface.kind !== "issue") return;
              useRightPanelStore.getState().activateSurface(ISSUES_PANEL_REF, surface.id);
              selectSurfaceInUrl(surface);
            }}
            onCloseSurface={(surface) => {
              if (surface.kind === "issue") closeSurface(surface);
            }}
            onCloseOtherSurfaces={(surface) => {
              useRightPanelStore.getState().closeOtherSurfaces(ISSUES_PANEL_REF, surface.id);
              if (surface.kind === "issue") selectSurfaceInUrl(surface);
            }}
            onCloseSurfacesToRight={(surface) => {
              useRightPanelStore.getState().closeSurfacesToRight(ISSUES_PANEL_REF, surface.id);
              const next = selectActiveRightPanelSurface(
                useRightPanelStore.getState().byThreadKey,
                ISSUES_PANEL_REF,
              );
              selectSurfaceInUrl(next?.kind === "issue" ? next : null);
            }}
            onCloseAllSurfaces={() => {
              useRightPanelStore.getState().closeAllSurfaces(ISSUES_PANEL_REF);
              selectSurfaceInUrl(null);
            }}
            onCopyFilePath={() => undefined}
            onAddBrowser={() => undefined}
            onAddBrowserInProfile={() => undefined}
            onAddTerminal={() => undefined}
            onAddDiff={() => undefined}
            onAddFiles={() => undefined}
            onAddPullRequest={() => undefined}
            onAddPullRequests={() => undefined}
            onAddIssue={() => undefined}
            onAddDevice={() => undefined}
            browserAvailable={false}
            terminalAvailable={false}
            diffAvailable={false}
            filesAvailable={false}
            pullRequestAvailable={false}
            pullRequestsAvailable={false}
            issueAvailable={false}
            deviceAvailable={false}
          >
            {renderedIssueSurface.kind === "issue" ? (
              <IssueDetailPanel
                key={renderedIssueSurface.id}
                environmentId={
                  (renderedIssueSurface.environmentId as EnvironmentId | undefined) ??
                  panelEnvironmentId
                }
                reference={{
                  projectId: renderedIssueSurface.projectId as ProjectId,
                  host: renderedIssueSurface.host,
                  repository: renderedIssueSurface.repository,
                  number: renderedIssueSurface.number,
                }}
                onBack={() => closeSurface(renderedIssueSurface)}
                onOpenIssue={(issue) =>
                  openIssueReference(
                    (renderedIssueSurface.environmentId as EnvironmentId | undefined) ??
                      panelEnvironmentId,
                    issue,
                  )
                }
                onActed={() => listQuery.refresh()}
              />
            ) : null}
          </RightPanelTabs>
        ) : null}
        {worktreeTarget !== null ? (
          <IssueWorktreeDialog
            open={worktreeOpen}
            onOpenChange={setWorktreeOpen}
            environmentId={worktreeTarget.environmentId}
            reference={issueRefForEntry(worktreeTarget)}
            issueTitle={worktreeTarget.title}
            linkedWork={issueLinkedWorkForEntry(worktreeTarget)}
            onActed={() => listQuery.refresh()}
          />
        ) : null}
        <IssueCreateDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          selection={createSelection}
          environmentId={createTarget?.environmentId ?? null}
          onCreated={(issue) => {
            setCreateOpen(false);
            if (createSelection !== null && createTarget !== null) {
              clearIssueDraft(browserStorage(), createSelection);
              useRightPanelStore.getState().openIssue(ISSUES_PANEL_REF, {
                environmentId: createTarget.environmentId,
                ...issue,
              });
              updateSearch({
                selectedIssue: issue.number,
                selectedProjectId: issue.projectId,
                selectedEnvironmentId: createTarget.environmentId,
                selectedRepository: issue.repository,
                selectedHost: issue.host,
              });
            }
            listQuery.refresh();
          }}
        />
      </div>
    </SidebarInset>
  );
}

function AuthState({
  detail,
  authorizationUrl,
  userCode,
  pending,
  onAuthenticate,
}: {
  readonly detail: string | null;
  readonly authorizationUrl: string | null;
  readonly userCode: string | null;
  readonly pending: boolean;
  readonly onAuthenticate: () => void;
}) {
  return (
    <Empty className="min-h-0 justify-center-safe overflow-y-auto [&>*]:shrink-0">
      <EmptyMedia variant="icon">
        <CircleDotIcon />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>Sign in to GitHub</EmptyTitle>
        <EmptyDescription>
          {detail ?? "Authenticate GitHub CLI on this host to browse and manage issues."}
        </EmptyDescription>
      </EmptyHeader>
      {userCode ? (
        <code className="rounded-md border bg-muted px-3 py-2 text-base font-semibold tracking-widest">
          {userCode}
        </code>
      ) : null}
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" onClick={onAuthenticate} disabled={pending}>
          {pending ? <Spinner aria-hidden size="sm" /> : null}
          {pending ? "Starting authentication…" : "Authenticate"}
        </Button>
        {authorizationUrl ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const localApi = readLocalApi();
              if (localApi) void localApi.shell.openExternal(authorizationUrl);
              else window.open(authorizationUrl, "_blank", "noopener,noreferrer");
            }}
          >
            <ExternalLinkIcon aria-hidden className="size-3.5" />
            Open authorization page
          </Button>
        ) : null}
      </div>
    </Empty>
  );
}
