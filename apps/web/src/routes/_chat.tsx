import { Outlet, createFileRoute, redirect, useParams } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo } from "react";

import { isCommandPaletteOpen } from "../commandPaletteBus";
import { ThreadRouteView } from "../components/ThreadRouteView";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { useClientSettings, useLegacySidebarEnabled } from "../hooks/useSettings";
import { openCommandPalette } from "../commandPaletteBus";
import { useProjects } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { selectProjectGroupingSettings } from "../logicalProject";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { dispatchPreviewAction } from "../components/preview/previewActionBus";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useScratchProject } from "../hooks/useScratchProject";
import {
  resolveScopedThreadActionProjectRef,
  resolveThreadActionWorkspaceOptions,
  startNewThreadFromContext,
} from "../lib/chatThreadActions";
import { projectScriptIdFromCommand } from "../projectScripts";
import { useUiStateStore } from "../uiStateStore";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isEditableFocused } from "../lib/editableFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { undoLatestThreadAction } from "../hooks/showThreadUndoNotice";
import { resolveShortcutCommand } from "../keybindings";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { isPreviewSupportedInRuntime } from "../previewStateStore";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { primaryServerKeybindingsAtom } from "~/state/server";

function ChatRouteGlobalShortcuts() {
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const selectedThreadKeysSize = useThreadSelectionStore((state) => state.selectedThreadKeys.size);
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread, routeThreadRef } =
    useHandleNewThread();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const legacySidebarEnabled = useLegacySidebarEnabled();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { scratchEnvironmentId, startScratchThread } = useScratchProject();
  const projectGroupCount = useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects,
        settings: projectGroupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: () => null,
      }).length,
    [primaryEnvironmentId, projectGroupingSettings, projects],
  );
  // New-thread shortcuts start in the sidebar's selected project and keep the
  // active worktree, so a follow-up lands where the current work is.
  const sidebarProjectScopeKey = useUiStateStore((state) => state.sidebarProjectScopeKey);
  const shortcutProjectRef = useMemo(() => {
    const selectedGroup =
      !legacySidebarEnabled && sidebarProjectScopeKey !== null
        ? buildSidebarProjectSnapshots({
            projects,
            settings: projectGroupingSettings,
            primaryEnvironmentId,
            resolveEnvironmentLabel: () => null,
          }).find((group) => group.projectKey === sidebarProjectScopeKey)
        : null;
    return resolveScopedThreadActionProjectRef(
      {
        activeDraftThread,
        activeThread: activeThread ?? undefined,
        defaultProjectRef,
        handleNewThread,
      },
      selectedGroup?.memberProjectRefs ?? null,
    );
  }, [
    activeDraftThread,
    activeThread,
    defaultProjectRef,
    handleNewThread,
    legacySidebarEnabled,
    primaryEnvironmentId,
    projectGroupingSettings,
    projects,
    sidebarProjectScopeKey,
  ]);
  const shortcutWorkspaceOptions = useMemo(
    () =>
      resolveThreadActionWorkspaceOptions(
        {
          activeDraftThread,
          activeThread: activeThread ?? undefined,
          defaultProjectRef,
          handleNewThread,
        },
        shortcutProjectRef,
      ),
    [activeDraftThread, activeThread, defaultProjectRef, handleNewThread, shortcutProjectRef],
  );
  const terminalOpen = useTerminalUiStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
  // The `previewOpen` shortcut-context flag here uses the store-only value;
  // the URL-aware arbitration lives inside ChatView's `onTogglePreview`,
  // which we invoke via the action bus to avoid duplicating the rule.
  const previewOpen = useRightPanelStore((state) =>
    routeThreadRef
      ? selectActiveRightPanel(state.byThreadKey, routeThreadRef) === "preview"
      : false,
  );
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
          previewFocus: isPreviewFocused(),
          previewOpen,
          editableFocus: isEditableFocused(event.target),
          modelPickerOpen: isModelPickerOpen(),
        },
      });

      if (isCommandPaletteOpen()) {
        return;
      }

      if (command === "thread.undo") {
        if (event.repeat || isModelPickerOpen()) return;
        if (undoLatestThreadAction()) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (event.key === "Escape" && selectedThreadKeysSize > 0) {
        event.preventDefault();
        clearSelection();
        return;
      }

      if (command === "chat.newLocal") {
        event.preventDefault();
        event.stopPropagation();
        if (shortcutProjectRef) {
          void handleNewThread(shortcutProjectRef, shortcutWorkspaceOptions ?? undefined);
        } else {
          openCommandPalette({ open: "new-thread-in" });
        }
        return;
      }

      if (command === "chat.newWithoutProject") {
        const environmentId = scratchEnvironmentId(
          activeThread?.environmentId ?? activeDraftThread?.environmentId ?? primaryEnvironmentId,
        );
        if (environmentId === null) return;
        event.preventDefault();
        event.stopPropagation();
        void startScratchThread(environmentId);
        return;
      }

      if (command === "chat.new") {
        event.preventDefault();
        event.stopPropagation();
        // The default sidebar routes creation through the command palette
        // whenever there is a real choice to make; the legacy sidebar (and
        // single-project setups) keep the immediate contextual create.
        if (!legacySidebarEnabled && projectGroupCount > 1) {
          openCommandPalette({ open: "new-thread-in" });
          return;
        }
        void startNewThreadFromContext({
          activeDraftThread,
          activeThread: activeThread ?? undefined,
          defaultProjectRef,
          handleNewThread,
        });
        return;
      }

      if (command === "preview.toggle") {
        event.preventDefault();
        event.stopPropagation();
        if (!routeThreadRef) return;
        if (!isPreviewSupportedInRuntime()) {
          toastManager.add(
            stackedThreadToast({
              type: "info",
              title: "Preview is desktop-only",
              description: "Open T3 Code in the desktop app to use the in-app preview.",
            }),
          );
          return;
        }
        dispatchPreviewAction("toggle-panel");
        return;
      }

      // The remaining preview commands only fire when the panel is the
      // currently-focused tenant. The `when: previewFocus` rule already
      // gates this, but defend against the keybinding being misconfigured.
      if (
        command === "preview.refresh" ||
        command === "preview.focusUrl" ||
        command === "preview.zoomIn" ||
        command === "preview.zoomOut" ||
        command === "preview.resetZoom"
      ) {
        event.preventDefault();
        event.stopPropagation();
        const action =
          command === "preview.refresh"
            ? "refresh"
            : command === "preview.focusUrl"
              ? "focus-url"
              : command === "preview.zoomIn"
                ? "zoom-in"
                : command === "preview.zoomOut"
                  ? "zoom-out"
                  : "reset-zoom";
        dispatchPreviewAction(action);
        return;
      }

      // Project action shortcuts run in a thread's workspace.
      if (command && projectScriptIdFromCommand(command) !== null && !routeThreadRef) {
        event.preventDefault();
        event.stopPropagation();
        toastManager.add({
          type: "info",
          title: "Open a thread to choose a worktree",
        });
      }
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [
    activeDraftThread,
    activeThread,
    clearSelection,
    handleNewThread,
    keybindings,
    defaultProjectRef,
    previewOpen,
    primaryEnvironmentId,
    projectGroupCount,
    routeThreadRef,
    scratchEnvironmentId,
    selectedThreadKeysSize,
    shortcutProjectRef,
    shortcutWorkspaceOptions,
    startScratchThread,
    legacySidebarEnabled,
    terminalOpen,
  ]);

  return null;
}

function ChatRouteLayout() {
  // Both thread routes render here, not in their own leaf components, so the
  // draft-to-thread promotion keeps one ChatView mounted across the swap.
  const threadTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  return (
    <>
      <ChatRouteGlobalShortcuts />
      {threadTarget ? <ThreadRouteView target={threadTarget} /> : <Outlet />}
    </>
  );
}

export const Route = createFileRoute("/_chat")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ChatRouteLayout,
});
