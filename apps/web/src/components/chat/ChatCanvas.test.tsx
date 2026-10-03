// @vitest-environment jsdom
import {
  EnvironmentId,
  NodeId,
  ProviderDriverKind,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
  type ScopedThreadRef,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import { act, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useRightPanelStore } from "../../rightPanelStore";
import { makeThreadProjectionFixture } from "../../test-fixtures";
import { PopoverCreateHandle } from "../ui/popover";
import { ChatCanvas } from "./ChatCanvas";
import { useChatCanvas } from "./ChatCanvasContext";
import type { ChatCanvasPreview } from "./chatCanvasLayout";
import { ThreadDetailsCard } from "./ThreadDetailsCard";
import { ThreadDetailsPanel, type ThreadDetailsPanelProps } from "./ThreadDetailsPanel";

const snapshots = vi.hoisted(() => ({
  projection: null as OrchestrationV2ThreadProjection | null,
  pullRequests: [] as ThreadPullRequestLink[],
  command: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => snapshots.command }));
vi.mock("../../state/entities", () => ({
  useThreadProjection: () => ({ projection: snapshots.projection }),
  useThreadShells: () => [],
  useProjects: () => [],
  useServerConfigs: () => new Map(),
}));
vi.mock("../../lib/archivedThreadsState", () => ({
  useArchivedThreadSnapshots: () => ({ snapshots: [] }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => snapshots.command }));
vi.mock("../../hooks/useT3ProjectFileScripts", () => ({ useT3ProjectFileScripts: () => [] }));
vi.mock("../ProjectScriptsControl", () => ({ default: () => null }));
vi.mock("../GitActionsControl", () => ({ default: () => null }));
vi.mock("./ThreadAutomationsPanel", () => ({ ThreadAutomationsPanel: () => null }));
vi.mock("./ThreadDetailsPrRow", () => ({
  ThreadDetailsPrRow: ({ number, label }: { number: number; label: string }) => (
    <div data-pr-row={number}>{label}</div>
  ),
}));
vi.mock("../BranchToolbar", async () => {
  const { ThreadDetailsPrRows } = await import("./ThreadDetailsPrRows");
  return {
    BranchToolbar: ({ panelSection }: { panelSection: string }) => {
      const link = snapshots.pullRequests[0];
      return panelSection === "branch" && link ? (
        <ThreadDetailsPrRows
          environmentId={EnvironmentId.make("canvas-test")}
          links={snapshots.pullRequests}
          currentLink={link}
          number={link.number}
          pr={null}
          status={null}
          project={null}
          label={`#${link.number}`}
          openAriaLabel={link.url}
          onOpen={snapshots.command}
          onOpenLink={snapshots.command}
        />
      ) : null;
    },
  };
});

const threadRef = {
  environmentId: EnvironmentId.make("canvas-test"),
  threadId: ThreadId.make("parent"),
};
const preview: ChatCanvasPreview = {
  key: "browser:test",
  width: 267,
  position: null,
  source: { width: 1600, height: 1000 },
};
const canvasChanges = vi.fn<(canvas: ReturnType<typeof useChatCanvas>) => void>();
const getAnimationsDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "getAnimations");
let dimensions: { width: number; height: number };
let contentHeights: { full: number; compact: number; essential: number };
let root: Root;
let container: HTMLDivElement;
let composer: HTMLDivElement;
let anchor: HTMLButtonElement;
let handle: ReturnType<typeof PopoverCreateHandle>;
let errors: unknown[];
const observers = new Map<
  ResizeObserver,
  { callback: ResizeObserverCallback; targets: Set<Element> }
>();

function LayoutProbe() {
  const canvas = useChatCanvas();
  useLayoutEffect(() => {
    canvasChanges(canvas);
  }, [canvas]);
  return null;
}

function FloatingPreview({ input }: { input: ChatCanvasPreview }) {
  const canvas = useChatCanvas();
  const report = canvas?.reportPreview;
  const clear = canvas?.clearPreview;
  useLayoutEffect(() => report?.(input), [report, input]);
  useLayoutEffect(() => () => clear?.(input.key), [clear, input.key]);
  return null;
}

beforeEach(() => {
  dimensions = { width: 1266, height: 499 };
  contentHeights = { full: 300, compact: 180, essential: 80 };
  errors = [];
  snapshots.projection = makeThreadProjectionFixture();
  snapshots.pullRequests = [];
  canvasChanges.mockClear();
  observers.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        observers.set(this, { callback, targets: new Set() });
      }
      observe(target: Element) {
        observers.get(this)?.targets.add(target);
      }
      unobserve(target: Element) {
        observers.get(this)?.targets.delete(target);
      }
      disconnect() {
        observers.delete(this);
      }
    },
  );
  const computedStyle = getComputedStyle;
  const probeStyles = document.createElement("div").style;
  probeStyles.width = "736px";
  probeStyles.minWidth = "640px";
  probeStyles.paddingLeft = "20px";
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    if (
      element.parentElement?.hasAttribute("data-chat-canvas") &&
      element.hasAttribute("aria-hidden")
    ) {
      return probeStyles;
    }
    return computedStyle(element, pseudo);
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-chat-canvas") ? dimensions.width : 0;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-chat-canvas") ? dimensions.height : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (
      this.firstElementChild?.matches(
        "section[aria-labelledby=thread-details-workspace-heading],section[aria-label=Workspace]",
      )
    ) {
      return (
        160 +
        this.querySelectorAll("li").length * 36 +
        this.querySelectorAll("[data-pr-row]").length * 36
      );
    }
    if (!this.firstElementChild?.hasAttribute("data-card-body")) return 0;
    const density = this.closest("[data-density]")?.getAttribute("data-density");
    return density === "compact"
      ? contentHeights.compact
      : density === "essential"
        ? contentHeights.essential
        : contentHeights.full;
  });
  useRightPanelStore.setState({ threadPanelVisibilityByThreadKey: {}, byThreadKey: {} });
  container = document.createElement("div");
  composer = document.createElement("div");
  anchor = document.createElement("button");
  document.body.append(container, composer, anchor);
  vi.spyOn(composer, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 736, 275));
  handle = PopoverCreateHandle();
  root = createRoot(container, { onUncaughtError: (error) => errors.push(error) });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  composer.remove();
  anchor.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (getAnimationsDescriptor)
    Object.defineProperty(Element.prototype, "getAnimations", getAnimationsDescriptor);
  else Reflect.deleteProperty(Element.prototype, "getAnimations");
});

async function render(input: ChatCanvasPreview | null = null, ref: ScopedThreadRef = threadRef) {
  await act(async () =>
    root.render(
      <StrictMode>
        <ChatCanvas composerOverlayElement={composer}>
          <LayoutProbe />
          {input ? <FloatingPreview input={input} /> : null}
          <ThreadDetailsCard
            threadRef={ref}
            anchor={{ current: anchor }}
            handle={handle}
            onPresentationChange={() => {}}
          >
            {(density) => <div data-card-body>{density}</div>}
          </ThreadDetailsCard>
        </ChatCanvas>
      </StrictMode>,
    ),
  );
}

async function resize() {
  await act(async () => {
    const pendingObservers = [...observers];
    for (const [observer, { callback }] of pendingObservers) callback([], observer);
  });
}

it("keeps the chat canvas unchanged when details resize without a floating preview", async () => {
  await render();
  const changes = canvasChanges.mock.calls.length;
  contentHeights.full = 350;
  await resize();
  expect(errors).toEqual([]);
  expect(container.querySelector("[data-density]")?.getAttribute("data-density")).toBe("full");
  expect(canvasChanges).toHaveBeenCalledTimes(changes);
});

it("settles card and preview placement instead of exceeding React's update limit", async () => {
  contentHeights.full = 820;
  await render(preview);
  expect(errors).toEqual([]);
  const card = container.querySelector<HTMLElement>("[data-thread-details-panel=inline]");
  expect(card).not.toBeNull();
  expect(card?.style.width).toBe("267px");
  const changes = canvasChanges.mock.calls.length;
  await resize();
  expect(canvasChanges).toHaveBeenCalledTimes(changes);
});

it("restores full details after space returns and survives closing and switching threads", async () => {
  await render();
  dimensions.height = 250;
  await resize();
  expect(container.querySelector("[data-density]")?.getAttribute("data-density")).toBe("compact");
  dimensions.height = 499;
  await resize();
  expect(container.querySelector("[data-density]")?.getAttribute("data-density")).toBe("full");
  await act(async () =>
    useRightPanelStore.getState().setThreadPanelOpen(threadRef, "inline", false),
  );
  expect(container.querySelector("[data-thread-details-panel=inline]")).toBeNull();
  await act(async () =>
    useRightPanelStore.getState().setThreadPanelOpen(threadRef, "inline", true),
  );
  await render(null, { ...threadRef, threadId: ThreadId.make("child") });
  expect(container.querySelector("[data-density]")?.getAttribute("data-density")).toBe("full");
  expect(errors).toEqual([]);
});

it("releases preview bounds when closed and restores the card after a docked panel closes", async () => {
  await render(preview);
  await render();
  expect(canvasChanges.mock.lastCall?.[0]?.layout.frame).toBeNull();
  dimensions.width = 900;
  await resize();
  expect(container.querySelector("[data-thread-details-panel=inline]")).toBeNull();
  dimensions.width = 1266;
  await resize();
  expect(container.querySelector("[data-density]")?.getAttribute("data-density")).toBe("full");
  await render(preview);
  expect(
    container.querySelector<HTMLElement>("[data-thread-details-panel=inline]")?.style.width,
  ).toBe("267px");
  expect(errors).toEqual([]);
});

it("renders agent and PR updates through the details panel without a floating preview", async () => {
  dimensions.height = 900;
  const projection = snapshots.projection!;
  const props: ThreadDetailsPanelProps = {
    environmentId: threadRef.environmentId,
    threadId: projection.thread.id,
    anchor: { current: anchor },
    handle,
    onPresentationChange: snapshots.command,
    activeProjectName: "Project",
    activeProjectScripts: [],
    preferredScriptId: null,
    keybindings: [],
    availableEditors: [],
    showOpenInPicker: false,
    gitCwd: "/workspace",
    isGitRepo: true,
    envLocked: false,
    availableEnvironments: [],
    onEnvironmentChange: snapshots.command,
    onEnvModeChange: snapshots.command,
    envMode: "local",
    startFromOrigin: false,
    onStartFromOriginChange: snapshots.command,
    onComposerFocusRequest: snapshots.command,
    versionMismatch: null,
    onDismissVersionMismatch: snapshots.command,
    onRunProjectScript: snapshots.command,
    onAddProjectScript: snapshots.command,
    onUpdateProjectScript: snapshots.command,
    onDeleteProjectScript: snapshots.command,
  };
  const update = async () => {
    await act(async () =>
      root.render(
        <StrictMode>
          <ChatCanvas composerOverlayElement={composer}>
            <LayoutProbe />
            <ThreadDetailsPanel {...props} />
          </ChatCanvas>
        </StrictMode>,
      ),
    );
    const changes = canvasChanges.mock.calls.length;
    await resize();
    expect(errors).toEqual([]);
    expect(canvasChanges).toHaveBeenCalledTimes(changes);
  };
  await update();
  for (const status of ["pending", "running", "waiting", "completed", "failed"] as const) {
    snapshots.projection = {
      ...projection,
      subagents: Array.from({ length: 8 }, (_, index) => ({
        id: NodeId.make(`agent-${index}`),
        threadId: projection.thread.id,
        runId: RunId.make("run"),
        parentNodeId: NodeId.make("parent-node"),
        origin: "app_owned" as const,
        createdBy: "agent" as const,
        driver: ProviderDriverKind.make("codex"),
        providerInstanceId: projection.thread.providerInstanceId,
        providerThreadId: null,
        childThreadId: ThreadId.make(`child-${index}`),
        nativeTaskRef: null,
        prompt: "Check the change",
        title: `Worker ${index}`,
        model: "gpt-5.4",
        status,
        result: null,
        startedAt: null,
        completedAt: null,
        updatedAt: projection.updatedAt,
      })),
    };
    snapshots.pullRequests = [1, 2].map((number) => ({
      host: "github.com",
      repository: "acme/project",
      number,
      url: `https://github.com/acme/project/pull/${number}`,
      source: "agent",
      linkedAt: "2026-10-03T14:43:00Z",
      snapshot: null,
      stack: null,
    }));
    await update();
    expect(container.textContent).toContain("#1");
    expect(container.textContent).toContain("Show 1 more");
    expect(container.textContent).toContain(
      status === "completed" || status === "failed" ? "Previous agents" : "Worker 0",
    );
  }
  snapshots.projection = projection;
  snapshots.pullRequests = [];
  await update();
  expect(container.textContent).not.toContain("Previous agents");
  expect(container.textContent).not.toContain("#1");
});
