// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId, type WorktreeRunSnapshot } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts/settings";
import { EMPTY_TERMINAL_SESSION_STATE } from "@t3tools/client-runtime/state/terminal";
import {
  applyWorktreeRunAttachEvent,
  type WorktreeRunState,
} from "@t3tools/client-runtime/state/worktreeRun";
import type { GhosttyTerminalSurfaceOptions } from "../terminal/ghostty/surface";
import { getTerminalFocusOwner } from "../lib/terminalFocus";
import { WorktreeRunTerminal } from "./WorktreeRunTerminal";
import ThreadTerminalDrawer from "./ThreadTerminalDrawer";
import { useTerminalUiStateStore, selectThreadTerminalUiState } from "../terminalUiStateStore";
import { nextTerminalId } from "@t3tools/shared/terminalLabels";

const mocks = vi.hoisted(() => ({
  run: null as WorktreeRunState | null,
  error: null as string | null,
  settings: {} as ClientSettings,
  createSurface: vi.fn(),
  commands: vi.fn(async (_command: string, _input: unknown) => ({
    _tag: "Success",
    value: undefined,
  })),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("../state/server", () => ({ serverEnvironment: { configValueAtom: () => null } }));
vi.mock("../state/preview", () => ({ previewEnvironment: { open: "preview.open" } }));
vi.mock("../state/terminal", () => ({
  terminalEnvironment: { write: "terminal.write", resize: "terminal.resize" },
}));
vi.mock("../state/worktreeRun", () => ({
  worktreeRunEnvironment: {
    attach: () => null,
    write: "run.write",
    resize: "run.resize",
    clear: "run.clear",
    stop: "run.stop",
    start: "run.start",
  },
}));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: () => ({ data: mocks.run, error: mocks.error }),
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: string) => (input: unknown) => mocks.commands(command, input),
}));
vi.mock("../state/terminalSessions", () => ({
  useAttachedTerminalSession: () => ({
    ...EMPTY_TERMINAL_SESSION_STATE,
    status: "running",
    version: 1,
  }),
}));
vi.mock("../editorPreferences", () => ({ useOpenInPreferredEditor: () => vi.fn() }));
vi.mock("../hooks/useSettings", () => ({
  useClientSettings: (select: (settings: ClientSettings) => unknown) => select(mocks.settings),
}));
vi.mock("../hooks/useLocalStorage", () => ({ useLocalStorage: () => [true, vi.fn()] }));
vi.mock("~/localApi", () => ({ readLocalApi: () => null }));
vi.mock("~/terminal/ghostty/surface", () => ({
  GhosttyTerminalSurface: { create: mocks.createSurface },
}));

const threadRef = { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") };
const target = {
  projectId: ProjectId.make("project"),
  workspacePath: "/workspace",
  scriptId: "dev",
};
const active = { environmentId: threadRef.environmentId, target };
const snapshot: WorktreeRunSnapshot = {
  target,
  name: "Dev",
  command: "vp dev",
  status: "running",
  pid: 123,
  history: "ready\r\n",
  exitCode: null,
  exitSignal: null,
  label: "Dev",
  updatedAt: "2026-09-28T00:00:00Z",
};
const keybindings = [] as const;
let container: HTMLDivElement;
let root: Root;
let screen: string;
let ready: () => void;
let options: GhosttyTerminalSurfaceOptions;
let surface: ReturnType<typeof createSurface>;

function createSurface(mount: HTMLElement) {
  return {
    focus: vi.fn(() => mount.focus()),
    dispose: vi.fn(),
    write: vi.fn((data: string) => {
      screen += data;
    }),
    resetAndWrite: vi.fn((data: string) => {
      screen = data;
    }),
    setVisible: vi.fn(),
    setTheme: vi.fn(),
    setFont: vi.fn(),
    fit: vi.fn(),
    isAtBottom: () => true,
    scrollToBottom: vi.fn(),
    clearSelection: vi.fn(),
    hasSelection: () => false,
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  mocks.settings = {
    ...DEFAULT_CLIENT_SETTINGS,
    fontFamilyTerminal: "monospace",
    fontSizeTerminal: 17,
  };
  mocks.run = applyWorktreeRunAttachEvent(null, { type: "snapshot", snapshot });
  mocks.error = null;
  mocks.commands.mockClear();
  screen = "";
  mocks.createSurface.mockImplementation(
    (mount: HTMLElement, nextOptions: GhosttyTerminalSurfaceOptions) => {
      options = nextOptions;
      surface = createSurface(mount);
      const created = surface;
      return new Promise((resolve) => {
        ready = () => resolve(created);
      });
    },
  );
  useTerminalUiStateStore.setState({ terminalUiStateByThreadKey: {} });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderRun(visible = true, scriptId = "dev") {
  await act(async () =>
    root.render(
      <div data-terminal-owner="drawer">
        <WorktreeRunTerminal
          active={{ ...active, target: { ...target, scriptId } }}
          threadRef={threadRef}
          terminalLabel="Dev"
          advancedTypography
          focusRequestId={1}
          autoFocus
          visible={visible}
          resizeEpoch={0}
          drawerHeight={200}
          keybindings={keybindings}
        />
      </div>,
    ),
  );
}

function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (element) => element.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

function Workflow() {
  const state = useTerminalUiStateStore((store) =>
    selectThreadTerminalUiState(store.terminalUiStateByThreadKey, threadRef),
  );
  const [selectedRun, setSelectedRun] = useState<typeof active | null>(active);
  const store = {
    newTerminal: useTerminalUiStateStore((state) => state.newTerminal),
    setActiveTerminal: useTerminalUiStateStore((state) => state.setActiveTerminal),
    closeTerminal: useTerminalUiStateStore((state) => state.closeTerminal),
    splitTerminal: useTerminalUiStateStore((state) => state.splitTerminal),
    splitTerminalVertical: useTerminalUiStateStore((state) => state.splitTerminalVertical),
  };
  return (
    <ThreadTerminalDrawer
      threadRef={threadRef}
      threadId={threadRef.threadId}
      cwd="/workspace"
      terminalIds={state.terminalIds}
      activeTerminalId={state.activeTerminalId}
      terminalGroups={state.terminalGroups}
      activeTerminalGroupId={state.activeTerminalGroupId}
      focusRequestId={0}
      height={200}
      keybindings={keybindings}
      worktreeRuns={[snapshot]}
      activeWorktreeRun={selectedRun}
      onActiveWorktreeRunChange={(next) =>
        setSelectedRun({ environmentId: threadRef.environmentId, target: next })
      }
      onCloseWorktreeRun={() => setSelectedRun(null)}
      onNewTerminal={() => store.newTerminal(threadRef, nextTerminalId(state.terminalIds))}
      onActiveTerminalChange={(id) => store.setActiveTerminal(threadRef, id)}
      onCloseTerminal={(id) => store.closeTerminal(threadRef, id)}
      onSplitTerminal={() => store.splitTerminal(threadRef, nextTerminalId(state.terminalIds))}
      onSplitTerminalVertical={() =>
        store.splitTerminalVertical(threadRef, nextTerminalId(state.terminalIds))
      }
      onHeightChange={() => {}}
      onAddTerminalContext={() => {}}
    />
  );
}

describe("workspace terminal lifecycle", () => {
  it("replays the latest snapshot after async readiness and sends queued input to the workspace target", async () => {
    await renderRun();
    options.onData("hello");
    await act(async () => ready());
    expect(screen).toBe(snapshot.history);
    expect(mocks.commands).toHaveBeenCalledWith("run.write", {
      environmentId: threadRef.environmentId,
      input: { ...target, data: "hello" },
    });
    expect(getTerminalFocusOwner()).toBe("drawer");
    expect(options.font).toEqual({ family: "monospace", size: 17 });
  });

  it("replays history arriving after readiness and resets when changing targets with identical output", async () => {
    mocks.run = null;
    await renderRun();
    await act(async () => ready());
    expect(screen).toBe("");
    mocks.run = applyWorktreeRunAttachEvent(null, { type: "snapshot", snapshot });
    await renderRun();
    expect(screen).toBe(snapshot.history);
    const previous = surface;
    await renderRun(true, "build");
    await act(async () => ready());
    expect(previous.dispose).toHaveBeenCalledOnce();
    expect(screen).toBe(snapshot.history);
  });

  it("does not steal composer focus after initialization and suspends hidden renderers", async () => {
    await renderRun();
    const input = document.createElement("input");
    container.append(input);
    input.focus();
    await act(async () => ready());
    expect(document.activeElement).toBe(input);
    expect(surface.focus).not.toHaveBeenCalled();
    await renderRun(false);
    expect(surface.setVisible).toHaveBeenLastCalledWith(false);
  });

  it("applies live font and theme changes through the common viewport", async () => {
    await renderRun();
    await act(async () => ready());
    mocks.settings = { ...mocks.settings, fontSizeTerminal: 19 };
    await renderRun();
    expect(surface.setFont).toHaveBeenLastCalledWith({ family: "monospace", size: 19 });
    surface.setTheme.mockClear();
    await act(async () => document.documentElement.classList.toggle("dark"));
    expect(surface.setTheme).toHaveBeenCalled();
  });

  it("reports attach failures even when output and version have not changed", async () => {
    await renderRun();
    await act(async () => ready());
    mocks.error = "Connection lost";
    await renderRun();
    expect(screen).toContain("Connection lost");
  });

  it("disposes a renderer whose view closed while initialization was pending", async () => {
    await renderRun();
    await act(async () => root.render(null));
    await act(async () => ready());
    expect(surface.dispose).toHaveBeenCalledOnce();
    expect(surface.focus).not.toHaveBeenCalled();
  });
});

describe("mixed terminal workflow", () => {
  it("creates a normal shell from a run, keeps one selection, and closes only the run view", async () => {
    await act(async () => root.render(<Workflow />));
    await act(async () => ready());
    await act(async () => button("New Terminal").click());
    expect(container.textContent).toContain("Terminal 1");
    expect(container.textContent).not.toContain("Shared");
    expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    expect(button("Open Dev terminal (running)").getAttribute("aria-pressed")).toBe("false");
    await act(async () => button("Open Dev terminal (running)").click());
    await act(async () => ready());
    expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    const splits = [
      ...container.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="Workspace runs cannot be split"]',
      ),
    ];
    expect(splits).toHaveLength(2);
    await act(async () => splits.forEach((split) => split.click()));
    expect(
      selectThreadTerminalUiState(
        useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
        threadRef,
      ).terminalIds,
    ).toEqual(["term-1"]);
    expect(splits.every((split) => split.disabled)).toBe(true);
    await act(async () => button("Close workspace run view (keeps running)").click());
    expect(container.textContent).toContain("Terminal 1");
    expect(button("Open Dev terminal (running)").getAttribute("aria-pressed")).toBe("false");
    expect(mocks.commands.mock.calls.some(([command]) => command === "run.stop")).toBe(false);
  });

  it("closing the only run view leaves an empty view without spawning a shell, and allows reopening", async () => {
    await act(async () => root.render(<Workflow />));
    await act(async () => ready());
    await act(async () => button("Close workspace run view (keeps running)").click());
    expect(container.textContent).toContain("No terminal selected.");
    await act(async () => button("Open Dev terminal (running)").click());
    await act(async () => ready());
    expect(screen).toBe(snapshot.history);
    expect(mocks.commands.mock.calls.some(([command]) => command === "run.stop")).toBe(false);
  });
});
