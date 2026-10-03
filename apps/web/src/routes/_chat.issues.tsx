import type {
  EnvironmentId,
  IssueListEntry,
  IssueListInput,
  IssueListState,
  IssueRepositorySelection,
  ProjectId,
} from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDotIcon,
  Clock3Icon,
  ExternalLinkIcon,
  GithubIcon,
  MessageCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  XCircleIcon,
} from "lucide-react";
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";

import {
  issueRepositoryForProject,
  issueRepositorySelectionForProject,
  issueEntriesForQuery,
  issueListSnapshotKey,
  normalizeIssueHost,
} from "../components/issue/issue.logic";
import { IssueCreateDialog } from "../components/issue/IssueCreateDialog";
import { IssueDetailPanel } from "../components/issue/IssueDetailPanel";
import { IssueLabelPill } from "../components/issue/IssueLabelPill";
import { PanelLayoutControls } from "../components/chat/PanelLayoutControls";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Spinner } from "../components/ui/spinner";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { SidebarInset } from "../components/ui/sidebar";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { RightPanelTabs } from "../components/RightPanelTabs";
import { isElectron } from "../env";
import { readLocalApi } from "../localApi";
import { useDebouncedValue } from "../state/queries";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useAllEnvironmentShellsBootstrapped, useProjects } from "../state/entities";
import {
  clearIssueDraft,
  issueEnvironment,
  readIssueListSnapshot,
  readIssueRepositorySelection,
  useIssueAuthStatus,
  useIssueList,
  writeIssueListSnapshot,
  writeIssueRepositorySelection,
} from "../state/issues";
import { useAtomCommand } from "../state/use-atom-command";
import {
  ISSUES_PANEL_REF,
  selectActiveRightPanelSurface,
  selectSelectedRightPanelSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
  type IssueSurface,
} from "../rightPanelStore";
import { cn } from "../lib/utils";
import { isCommandPaletteOpen } from "../commandPaletteBus";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../keybindings";
import { isTerminalFocused } from "../lib/terminalFocus";
import { usePanelAnimationSettings, usePanelPresence } from "../panelAnimations";
import { primaryServerKeybindingsAtom } from "../state/server";

export interface IssuesSearch {
  readonly state: IssueListState;
  readonly q?: string;
  readonly projectId?: ProjectId;
  readonly environmentId?: EnvironmentId;
  readonly host?: string;
  readonly selectedIssue?: number;
}

const ISSUE_STATES: ReadonlyArray<{ readonly value: IssueListState; readonly label: string }> = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

export const Route = createFileRoute("/_chat/issues")({
  validateSearch: (raw: Record<string, unknown>): IssuesSearch => ({
    state: raw.state === "closed" || raw.state === "all" ? raw.state : "open",
    ...(typeof raw.q === "string" && raw.q.trim() ? { q: raw.q.slice(0, 200) } : {}),
    ...(typeof raw.projectId === "string" && raw.projectId
      ? { projectId: raw.projectId as ProjectId }
      : {}),
    ...(typeof raw.environmentId === "string" && raw.environmentId
      ? { environmentId: raw.environmentId as EnvironmentId }
      : {}),
    ...(typeof raw.host === "string" && raw.host
      ? { host: normalizeIssueHost(raw.host).slice(0, 200) }
      : {}),
    ...(typeof raw.selectedIssue === "number" &&
    Number.isSafeInteger(raw.selectedIssue) &&
    raw.selectedIssue > 0
      ? { selectedIssue: raw.selectedIssue }
      : {}),
  }),
  component: IssuesRouteView,
});

function IssuesRouteView() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const projects = useProjects();
  const projectsReady = useAllEnvironmentShellsBootstrapped();
  const { activeDraftThread, activeThread } = useHandleNewThread();
  const [rememberedSelection, setRememberedSelection] = useState<IssueRepositorySelection | null>(
    () => {
      if (typeof window === "undefined") return null;
      return readIssueRepositorySelection(window.localStorage);
    },
  );
  const issueProjects = useMemo(
    () => projects.filter((project) => issueRepositoryForProject(project) !== null),
    [projects],
  );
  const compatibleProjects = issueProjects;
  const explicitProject = useMemo(
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
  const activeProject = useMemo(() => {
    const activeProjectId = activeThread?.projectId ?? activeDraftThread?.projectId;
    const activeEnvironmentId = activeThread?.environmentId ?? activeDraftThread?.environmentId;
    if (activeProjectId === undefined || activeEnvironmentId === undefined) return null;
    return (
      issueProjects.find(
        (project) =>
          project.id === activeProjectId && project.environmentId === activeEnvironmentId,
      ) ?? null
    );
  }, [
    activeDraftThread?.environmentId,
    activeDraftThread?.projectId,
    activeThread?.environmentId,
    activeThread?.projectId,
    issueProjects,
  ]);
  const rememberedProject = useMemo(() => {
    if (rememberedSelection === null) return null;
    const matchingProjects = issueProjects.filter((project) => {
      const descriptor = issueRepositoryForProject(project);
      return (
        project.id === rememberedSelection.projectId &&
        descriptor !== null &&
        descriptor.repository.toLowerCase() === rememberedSelection.repository.toLowerCase()
      );
    });
    return (
      matchingProjects.find(
        (project) =>
          issueRepositoryForProject(project)?.host ===
          normalizeIssueHost(rememberedSelection.host ?? ""),
      ) ??
      matchingProjects[0] ??
      null
    );
  }, [issueProjects, rememberedSelection]);
  const selectedProject =
    explicitProject ?? activeProject ?? rememberedProject ?? compatibleProjects[0] ?? null;
  const descriptor = selectedProject === null ? null : issueRepositoryForProject(selectedProject);
  const selectedRepositoryHosts = useMemo(() => {
    if (descriptor === null) return [];
    return [
      ...new Set(
        issueProjects
          .map((project) => issueRepositoryForProject(project))
          .filter(
            (candidate): candidate is NonNullable<typeof candidate> =>
              candidate !== null &&
              candidate.repository.toLowerCase() === descriptor.repository.toLowerCase(),
          )
          .map((candidate) => candidate.host),
      ),
    ].toSorted();
  }, [descriptor, issueProjects]);
  const selectedHost =
    search.host ??
    (selectedProject !== null && selectedProject === rememberedProject
      ? rememberedSelection?.host
      : undefined) ??
    descriptor?.host;
  const selection = useMemo(
    () => issueRepositorySelectionForProject(selectedProject, selectedHost),
    [selectedHost, selectedProject],
  );
  const updateSearch = useCallback(
    (patch: { [K in keyof IssuesSearch]?: IssuesSearch[K] | undefined }) => {
      void navigate({
        search: (previous: IssuesSearch): IssuesSearch => {
          const next = { ...previous, ...patch };
          return {
            state: next.state ?? previous.state,
            ...(next.q ? { q: next.q } : {}),
            ...(next.projectId ? { projectId: next.projectId } : {}),
            ...(next.environmentId ? { environmentId: next.environmentId } : {}),
            ...(next.host ? { host: next.host } : {}),
            ...(next.selectedIssue ? { selectedIssue: next.selectedIssue } : {}),
          };
        },
        replace: true,
      });
    },
    [navigate],
  );

  useEffect(() => {
    if (selection === null) return;
    writeIssueRepositorySelection(
      typeof window === "undefined" ? undefined : window.localStorage,
      selection,
    );
    setRememberedSelection(selection);
  }, [selection]);

  const typedQuery = (search.q ?? "").trim();
  const sentQuery = useDebouncedValue(typedQuery, 250);
  const listKey =
    selection === null ? "none" : issueListSnapshotKey(selection, search.state, sentQuery);
  const [page, setPage] = useState<{
    readonly key: string;
    readonly cursors: ReadonlyArray<Readonly<Record<string, string>>>;
  }>({ key: listKey, cursors: [] });
  const pageState = page.key === listKey ? page : { key: listKey, cursors: [] };
  useEffect(() => {
    setPage({ key: listKey, cursors: [] });
  }, [listKey]);
  const listTargets = useMemo<
    ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly input: IssueListInput }>
  >(() => {
    if (selection === null || selectedProject === null) return [];
    return [null, ...pageState.cursors].map((cursors) => ({
      environmentId: selectedProject.environmentId,
      input: {
        state: search.state,
        repository: selection,
        limit: 50,
        ...(sentQuery ? { query: sentQuery } : {}),
        ...(cursors ? { cursors } : {}),
      },
    }));
  }, [pageState.cursors, search.state, selection, selectedProject, sentQuery]);
  const listQuery = useIssueList(listTargets);
  const authQuery = useIssueAuthStatus(
    selection === null || selectedProject === null
      ? null
      : {
          environmentId: selectedProject.environmentId,
          input: { provider: "github", host: selection.host },
        },
  );
  const [snapshot, setSnapshot] = useState(() =>
    readIssueListSnapshot(typeof window === "undefined" ? undefined : window.localStorage, listKey),
  );
  useEffect(() => {
    setSnapshot(
      readIssueListSnapshot(
        typeof window === "undefined" ? undefined : window.localStorage,
        listKey,
      ),
    );
  }, [listKey]);
  useEffect(() => {
    if (!listQuery.data || selection === null || listQuery.data.errors.length > 0) return;
    const result = {
      providers: listQuery.data.providers,
      entries: listQuery.data.entries,
      errors: listQuery.data.errors,
      truncated: listQuery.data.truncatedEnvironments.length > 0,
      nextCursors: Object.fromEntries(
        [...listQuery.data.nextCursorsByEnvironment.values()].flatMap((value) =>
          Object.entries(value),
        ),
      ),
    };
    writeIssueListSnapshot(
      typeof window === "undefined" ? undefined : window.localStorage,
      listKey,
      result,
    );
    setSnapshot({ version: 1, savedAt: Date.now(), result });
  }, [listKey, listQuery.data, selection]);

  const snapshotData = snapshot
    ? {
        entries: snapshot.result.entries,
        providers: snapshot.result.providers,
        errors: snapshot.result.errors,
        truncatedEnvironments: snapshot.result.truncated
          ? [selectedProject?.environmentId ?? ("" as EnvironmentId)]
          : [],
        nextCursorsByEnvironment: new Map<EnvironmentId, Record<string, string>>(),
      }
    : null;
  const listErrorText = listQuery.error ?? listQuery.data?.errors[0]?.message ?? null;
  const hasListError = listErrorText !== null;
  const stale = hasListError && snapshotData !== null;
  // A response carrying a repository error is not a successful empty response. Keep the last
  // known-good snapshot in front of it, so a transient provider failure cannot erase the list.
  const data = stale ? snapshotData : (listQuery.data ?? snapshotData);
  const entries = useMemo(
    () => issueEntriesForQuery(data?.entries ?? [], typedQuery),
    [data?.entries, typedQuery],
  );
  const isRefreshing = listQuery.isPending && data !== null;
  const authLoading =
    selection !== null &&
    authQuery.isPending &&
    authQuery.data === null &&
    !listQuery.isPending &&
    data === null;
  const [newIssueOpen, setNewIssueOpen] = useState(false);
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
  const renderedIssueSurface = rightPanelPresence.value?.activeSurface ?? null;
  const renderedRightPanelSurfaces = rightPanelPresence.value?.surfaces ?? [];
  const openIssue = useCallback(
    (entry: {
      readonly projectId: ProjectId;
      readonly host: string;
      readonly repository: string;
      readonly number: number;
      readonly url: string;
    }) => {
      useRightPanelStore.getState().openIssue(ISSUES_PANEL_REF, {
        ...(selectedProject === null ? {} : { environmentId: selectedProject.environmentId }),
        projectId: entry.projectId,
        host: entry.host,
        repository: entry.repository,
        number: entry.number,
        url: entry.url,
      });
      updateSearch({
        projectId: entry.projectId,
        environmentId: selectedProject?.environmentId,
        host: entry.host,
        selectedIssue: entry.number,
      });
    },
    [selectedProject, updateSearch],
  );
  useEffect(() => {
    if (!selection || !selectedProject || !search.selectedIssue) return;
    const existing = entries.find((entry) => entry.number === search.selectedIssue);
    if (existing) {
      openIssue(existing);
      return;
    }
    useRightPanelStore.getState().openIssue(ISSUES_PANEL_REF, {
      environmentId: selectedProject.environmentId,
      projectId: selectedProject.id,
      ...(selection.host ? { host: selection.host } : {}),
      repository: selection.repository,
      number: search.selectedIssue,
    });
  }, [entries, openIssue, search.selectedIssue, selectedProject, selection]);
  const loadMore = () => {
    if (listQuery.isPending || !data || selection === null || selectedProject === null) return;
    const cursors = data.nextCursorsByEnvironment.get(selectedProject.environmentId);
    if (!cursors || Object.keys(cursors).length === 0) return;
    setPage((current) => ({
      key: listKey,
      cursors: [...(current.key === listKey ? current.cursors : []), cursors],
    }));
  };
  const refresh = useCallback(() => {
    if (!listQuery.isPending) listQuery.refresh();
    if (!authQuery.isPending) authQuery.refresh();
  }, [authQuery, listQuery]);
  const authStart = useAtomCommand(issueEnvironment.authStart, { reportFailure: false });
  const [authError, setAuthError] = useState<string | null>(null);
  const [authPending, setAuthPending] = useState(false);
  const startAuth = async () => {
    if (authPending || !selectedProject || !selection) return;
    setAuthPending(true);
    setAuthError(null);
    try {
      const result = await authStart({
        environmentId: selectedProject.environmentId,
        input: { provider: "github", host: selection.host },
      });
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

  const errorText = listErrorText;
  const unavailable =
    !stale &&
    errorText !== null &&
    /(required|unavailable|unsupported|missing|cannot be browsed)/iu.test(errorText);
  const unauthenticated =
    !stale &&
    (authQuery.data?.status === "unauthenticated" ||
      (errorText !== null && /not authenticated|unauthenticated/iu.test(errorText)));
  const showLoading = selection !== null && listQuery.isPending && data === null;
  const panelEnvironmentId =
    (renderedIssueSurface?.environmentId as EnvironmentId | undefined) ??
    selectedProject?.environmentId ??
    null;
  const selectSurfaceInUrl = (surface: IssueSurface | null) =>
    updateSearch(
      surface === null
        ? { selectedIssue: undefined }
        : {
            projectId: surface.projectId as ProjectId,
            environmentId: surface.environmentId as EnvironmentId | undefined,
            host: surface.host,
            selectedIssue: surface.number,
          },
    );
  const closePanel = (surface: IssueSurface) => {
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
  const closeActiveSurfaceFromShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (activeSurface === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) closePanel(activeSurface);
  });
  const toggleRightPanelFromShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (selectedIssueSurface === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) toggleRightPanel();
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isCommandPaletteOpen()) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: { terminalFocus: isTerminalFocused(), terminalOpen: false },
      });
      if (command === "rightPanel.close") closeActiveSurfaceFromShortcut(event);
      if (command === "rightPanel.toggle") toggleRightPanelFromShortcut(event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keybindings]);
  const panelControls = (
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
      rightPanelAvailable={selectedIssueSurface !== null}
      rightPanelOpen={rightPanelState.isOpen}
      rightPanelShortcutLabel={shortcutLabelForCommand(keybindings, "rightPanel.toggle")}
      rightPanelUnavailableLabel="Select an issue first"
      onToggleTerminal={() => undefined}
      onToggleRightPanel={toggleRightPanel}
    />
  );
  const titlebarPanelControls = (
    <div className="absolute top-[var(--workspace-controls-top)] right-[var(--workspace-controls-right)] z-50 mr-px flex h-[var(--workspace-topbar-height)] items-center [-webkit-app-region:no-drag]">
      {panelControls}
    </div>
  );
  const showListError = hasListError && !stale && !unavailable && !unauthenticated;
  const body = showLoading ? (
    <LoadingState />
  ) : authLoading ? (
    <LoadingState label="Checking GitHub authentication" />
  ) : unavailable ? (
    <UnavailableState
      message={errorText ?? "GitHub Issues are unavailable for this environment."}
      onRetry={refresh}
    />
  ) : unauthenticated ? (
    <AuthState
      detail={authError ?? authQuery.data?.detail ?? errorText}
      authorizationUrl={authQuery.data?.authorizationUrl ?? null}
      userCode={authQuery.data?.userCode ?? null}
      pending={authPending}
      onAuthenticate={startAuth}
    />
  ) : !projectsReady ? (
    <LoadingState label="Loading projects" />
  ) : issueProjects.length === 0 ? (
    <EmptyProjectState />
  ) : hasListError && entries.length === 0 ? (
    <ErrorState
      message={
        stale
          ? `Could not refresh the issue list. ${errorText ?? "Showing no cached issues."}`
          : (errorText ?? "GitHub did not return an issue list.")
      }
      onRetry={refresh}
    />
  ) : entries.length === 0 ? (
    <EmptyIssueState query={typedQuery} onCreate={() => setNewIssueOpen(true)} />
  ) : (
    <>
      {showListError ? (
        <InlineErrorState message={errorText ?? "Some repository issues could not be refreshed."} />
      ) : null}
      <IssueRows
        entries={entries}
        selectedNumber={activeSurface?.number ?? search.selectedIssue ?? null}
        onSelect={openIssue}
      />
    </>
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="relative flex min-h-0 flex-1">
        {rightPanelPresence.present ? titlebarPanelControls : null}
        <main className="flex min-w-0 flex-1 flex-col">
          <WorkspacePageHeader electron={isElectron} className="border-b">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <GithubIcon className="size-4" />
              <h1 className="truncate text-sm font-semibold">Issues</h1>
              {selection ? (
                <span className="truncate text-xs text-muted-foreground">
                  {selection.repository}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" onClick={() => setNewIssueOpen(true)} disabled={selection === null}>
                <PlusIcon /> New issue
              </Button>
              {!rightPanelPresence.present ? panelControls : null}
            </div>
          </WorkspacePageHeader>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
              <label className="flex min-w-48 flex-1 items-center gap-2 rounded-md border bg-background px-2">
                <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
                <Input
                  unstyled
                  type="search"
                  value={typedQuery}
                  onChange={(event) => updateSearch({ q: event.target.value })}
                  placeholder="Search issues"
                  aria-label="Search issues"
                />
              </label>
              <Select
                value={selectedProject?.id ?? null}
                onValueChange={(projectId) => {
                  const project = compatibleProjects.find(
                    (candidate) => candidate.id === projectId,
                  );
                  if (!project) return;
                  updateSearch({
                    projectId: project.id,
                    environmentId: project.environmentId,
                    host: undefined,
                    selectedIssue: undefined,
                  });
                }}
              >
                <SelectTrigger size="sm" className="max-w-72 min-w-48" aria-label="Project">
                  <SelectValue>
                    {selectedProject
                      ? `${selectedProject.title} · ${descriptor?.repository ?? ""}`
                      : "Choose project"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {(compatibleProjects.length > 0 ? compatibleProjects : issueProjects).map(
                    (project) => (
                      <SelectItem key={`${project.environmentId}:${project.id}`} value={project.id}>
                        {project.title} · {issueRepositoryForProject(project)?.repository}
                      </SelectItem>
                    ),
                  )}
                </SelectPopup>
              </Select>
              {selectedRepositoryHosts.length > 1 ? (
                <Select
                  value={selectedHost ?? null}
                  onValueChange={(host) => {
                    if (host) updateSearch({ host, selectedIssue: undefined });
                  }}
                >
                  <SelectTrigger size="sm" className="min-w-36 max-w-56" aria-label="GitHub host">
                    <SelectValue>{selectedHost ?? "Choose host"}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    {selectedRepositoryHosts.map((host) => (
                      <SelectItem key={host} value={host}>
                        {host}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              ) : null}
              <div className="flex rounded-md border p-0.5">
                {ISSUE_STATES.map((state) => (
                  <Button
                    key={state.value}
                    size="xs"
                    variant={search.state === state.value ? "secondary" : "ghost"}
                    onClick={() => updateSearch({ state: state.value, selectedIssue: undefined })}
                  >
                    {state.label}
                  </Button>
                ))}
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Refresh issues"
                onClick={refresh}
                disabled={isRefreshing}
              >
                <RefreshCwIcon className={cn(isRefreshing && "animate-spin")} />
              </Button>
            </div>
            {isRefreshing ? (
              <div className="flex items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
                <Spinner aria-label="Refreshing issues" /> Refreshing issues…
              </div>
            ) : null}
            {stale ? (
              <div className="flex items-center gap-2 border-b bg-warning-surface/40 px-4 py-2 text-xs text-warning-foreground">
                <Clock3Icon className="size-3.5" /> Showing a stale snapshot
                {snapshot ? ` from ${new Date(snapshot.savedAt).toLocaleString()}` : ""}.{" "}
                <span className="min-w-0 truncate">{errorText ?? "Refresh failed."}</span>
                <Button size="xs" variant="ghost" onClick={refresh} disabled={isRefreshing}>
                  Retry
                </Button>
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-5xl">{body}</div>
              {data?.truncatedEnvironments.length ? (
                <div className="flex justify-center border-t py-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={loadMore}
                    disabled={listQuery.isPending}
                  >
                    Load more issues
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </main>
        {rightPanelPresence.present && renderedIssueSurface && panelEnvironmentId ? (
          <RightPanelTabs
            mode="inline"
            open={rightPanelState.isOpen}
            widthStorageKey="t3code:work-item-panel-width"
            defaultWidth={typeof window === "undefined" ? 640 : Math.floor(window.innerWidth / 2)}
            surfaces={renderedRightPanelSurfaces}
            environmentId={panelEnvironmentId}
            activeSurfaceId={renderedIssueSurface.id}
            pendingSurfaceIds={new Set()}
            previewSessions={{}}
            desktopByTabId={{}}
            terminalLabelsById={new Map()}
            onActivate={(surface) => {
              if (surface.kind === "issue") {
                useRightPanelStore.getState().activateSurface(ISSUES_PANEL_REF, surface.id);
                selectSurfaceInUrl(surface);
              }
            }}
            onCloseSurface={(surface) => {
              if (surface.kind === "issue") closePanel(surface);
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
              updateSearch({ selectedIssue: undefined });
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
                  (renderedIssueSurface.environmentId as EnvironmentId) ?? panelEnvironmentId
                }
                reference={{
                  projectId: renderedIssueSurface.projectId as ProjectId,
                  host: renderedIssueSurface.host,
                  repository: renderedIssueSurface.repository,
                  number: renderedIssueSurface.number,
                }}
                onBack={() => closePanel(renderedIssueSurface)}
              />
            ) : null}
          </RightPanelTabs>
        ) : null}
        <IssueCreateDialog
          open={newIssueOpen}
          onOpenChange={setNewIssueOpen}
          selection={selection}
          environmentId={selectedProject?.environmentId ?? null}
          onCreated={(issue) => {
            setNewIssueOpen(false);
            if (selection) {
              clearIssueDraft(
                typeof window === "undefined" ? undefined : window.localStorage,
                selection,
              );
            }
            openIssue(issue);
            listQuery.refresh();
          }}
        />
      </div>
    </SidebarInset>
  );
}
function IssueRows({
  entries,
  selectedNumber,
  onSelect,
}: {
  readonly entries: ReadonlyArray<IssueListEntry>;
  readonly selectedNumber: number | null;
  readonly onSelect: (entry: IssueListEntry) => void;
}) {
  return (
    <div className="divide-y">
      {entries.map((entry) => (
        <button
          type="button"
          key={`${entry.host}:${entry.repository}:${entry.number}`}
          className={cn(
            "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/45 focus-visible:bg-accent/45 focus-visible:outline-none",
            selectedNumber === entry.number && "bg-accent/55",
          )}
          onClick={() => onSelect(entry)}
        >
          <span
            className={cn(
              "mt-0.5 shrink-0",
              entry.state === "open"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-muted-foreground",
            )}
          >
            <CircleDotIcon className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{entry.title}</span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>#{entry.number}</span>
              <span>{entry.author?.login ?? "Unknown author"}</span>
              <span>{new Date(entry.updatedAt).toLocaleDateString()}</span>
              {entry.commentsCount > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <MessageCircleIcon className="size-3" />
                  {entry.commentsCount}
                </span>
              ) : null}
            </span>
            <span className="mt-2 flex flex-wrap gap-1">
              {entry.labels.slice(0, 4).map((label) => (
                <IssueLabelPill key={label.name} name={label.name} color={label.color} />
              ))}
            </span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{entry.repository}</span>
        </button>
      ))}
    </div>
  );
}

function LoadingState({ label = "Loading issues" }: { readonly label?: string }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
      <Spinner aria-label={label} />
      <span>{label}</span>
    </div>
  );
}
function EmptyProjectState() {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-2 p-8 text-center">
      <GithubIcon className="size-6 text-muted-foreground" />
      <h2 className="font-medium">No GitHub repository projects</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Add a GitHub project to browse its issues here.
      </p>
    </div>
  );
}
function EmptyIssueState({
  query,
  onCreate,
}: {
  readonly query: string;
  readonly onCreate: () => void;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
      <CircleCheckIcon className="size-6 text-muted-foreground" />
      <h2 className="font-medium">{query ? "No matching issues" : "No issues yet"}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        {query
          ? "Try a different search or clear the filter."
          : "Create the first issue for this repository."}
      </p>
      {!query ? (
        <Button size="sm" onClick={onCreate}>
          <PlusIcon /> New issue
        </Button>
      ) : null}
    </div>
  );
}
function InlineErrorState({ message }: { readonly message: string }) {
  return (
    <div className="flex items-start gap-2 border-b bg-destructive/6 px-4 py-3 text-sm text-destructive">
      <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
      <span>{message} Try again to refresh the repository list.</span>
    </div>
  );
}
function ErrorState({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
      <CircleAlertIcon className="size-6 text-destructive" />
      <h2 className="font-medium">Could not load issues</h2>
      <p className="max-w-lg text-sm text-muted-foreground">{message}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        <RefreshCwIcon /> Try again
      </Button>
    </div>
  );
}
function UnavailableState({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
      <XCircleIcon className="size-6 text-warning-foreground" />
      <h2 className="font-medium">GitHub Issues unavailable</h2>
      <p className="max-w-lg text-sm text-muted-foreground">{message}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        <RefreshCwIcon /> Check again
      </Button>
    </div>
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
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
      <GithubIcon className="size-6" />
      <h2 className="font-medium">Sign in to GitHub</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        {detail ?? "Authenticate GitHub CLI on this host to browse and manage issues."}
      </p>
      {userCode ? (
        <code className="rounded-md border bg-muted px-3 py-2 text-base font-semibold tracking-widest">
          {userCode}
        </code>
      ) : null}
      <Button size="sm" onClick={onAuthenticate} disabled={pending}>
        {pending ? <Spinner aria-label="Starting GitHub authentication" /> : null}
        {pending ? "Starting authentication…" : "Authenticate"}
      </Button>
      {authorizationUrl ? (
        <Button
          size="sm"
          variant="link"
          onClick={() => {
            if (!authorizationUrl) return;
            const localApi = readLocalApi();
            if (localApi) void localApi.shell.openExternal(authorizationUrl);
            else window.open(authorizationUrl, "_blank", "noopener,noreferrer");
          }}
        >
          Open authorization page <ExternalLinkIcon />
        </Button>
      ) : null}
    </div>
  );
}
