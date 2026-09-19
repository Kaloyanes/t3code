import { act, cloneElement, type ReactElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { AsyncResult } from "effect/unstable/reactivity";

vi.mock("lucide-react", () => {
  const Icon = ({ "data-icon": dataIcon, ...props }: { "data-icon": string }) => (
    <span data-icon={dataIcon} {...props} />
  );
  return {
    ChevronDownIcon: (props: object) => <Icon data-icon="chevron" {...props} />,
    DownloadIcon: (props: object) => <Icon data-icon="download" {...props} />,
    LoaderCircleIcon: (props: object) => <Icon data-icon="loader" {...props} />,
    PlusIcon: (props: object) => <Icon data-icon="plus" {...props} />,
    SettingsIcon: (props: object) => <Icon data-icon="settings" {...props} />,
    SquareIcon: (props: object) => <Icon data-icon="square" {...props} />,
  };
});

vi.mock("~/projectScripts", () => ({
  commandForProjectScript: (id: string) => `script.${id}.run`,
  primaryProjectScript: (scripts: ReadonlyArray<{ id: string; runOnWorktreeCreate: boolean }>) =>
    scripts.find((script) => !script.runOnWorktreeCreate) ?? scripts[0] ?? null,
}));

vi.mock("~/keybindings", () => ({ shortcutLabelForCommand: () => null }));

vi.mock("./projectScriptEditor", () => ({
  EMPTY_PROJECT_SCRIPT_INPUT: {
    name: "",
    command: "",
    icon: "play",
    runOnWorktreeCreate: false,
    scope: "thread",
    waitForSetup: false,
    keybinding: null,
    previewUrl: null,
    autoOpenPreview: false,
  },
  editorRequestForScript: (script: { id: string; name: string; command: string }) => ({
    scriptId: script.id,
    initial: {
      name: script.name,
      command: script.command,
      icon: "play",
      runOnWorktreeCreate: false,
      scope: "worktree",
      waitForSetup: false,
      keybinding: null,
      previewUrl: null,
      autoOpenPreview: false,
    },
  }),
  ProjectScriptEditorDialog: ({ request }: { request: unknown }) =>
    request ? <div data-testid="editor-open" /> : null,
  ScriptIcon: ({ icon, ...props }: { icon: string; className?: string }) => (
    <span data-icon={`script-${icon}`} {...props} />
  ),
}));

vi.mock("./ui/button", () => ({
  Button: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("./ui/group", () => ({
  Group: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  GroupSeparator: () => null,
}));

function renderSlot(render: ReactElement | undefined, children: ReactNode) {
  return render ? cloneElement(render, undefined, children) : children;
}

vi.mock("./ui/menu", () => ({
  Menu: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  MenuGroup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  MenuGroupLabel: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  MenuItem: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => (
    <button data-slot="menu-item" {...props}>
      {children}
    </button>
  ),
  MenuPopup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  MenuSeparator: () => null,
  MenuShortcut: ({ children }: { children?: ReactNode }) => <kbd>{children}</kbd>,
  MenuTrigger: ({ render, children }: { render?: ReactElement; children?: ReactNode }) =>
    renderSlot(render, children),
}));

vi.mock("./ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipPopup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ render, children }: { render?: ReactElement; children?: ReactNode }) =>
    renderSlot(render, children),
}));

import type { ProjectScript } from "@t3tools/contracts";
import ProjectScriptsControl from "./ProjectScriptsControl";

const scripts = [
  {
    id: "build",
    name: "Build",
    command: "pnpm build",
    icon: "build",
    runOnWorktreeCreate: false,
    scope: "thread",
  },
  {
    id: "worktree-dev",
    name: "Worktree dev",
    command: "pnpm dev",
    icon: "debug",
    runOnWorktreeCreate: false,
    scope: "worktree",
  },
] satisfies ReadonlyArray<ProjectScript>;

const action = async () => AsyncResult.success(undefined);

function renderControl(
  input: {
    startingScriptIds?: ReadonlySet<string>;
    runningScriptIds?: ReadonlySet<string>;
  } = {},
) {
  let nextRenderer!: ReactTestRenderer;
  act(() => {
    nextRenderer = create(
      <ProjectScriptsControl
        scripts={scripts}
        keybindings={[]}
        {...(input.startingScriptIds ? { startingScriptIds: input.startingScriptIds } : {})}
        {...(input.runningScriptIds ? { runningScriptIds: input.runningScriptIds } : {})}
        onRunScript={vi.fn()}
        onStopScript={vi.fn()}
        onAddScript={action}
        onUpdateScript={action}
        onDeleteScript={action}
        supportsWorktreeRuns
      />,
    );
  });
  return nextRenderer;
}

let renderer: ReactTestRenderer | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

describe("ProjectScriptsControl", () => {
  it("shows worktree actions in Run and opens their editor", () => {
    renderer = renderControl();

    const actionItems = renderer.root.findAllByProps({ "data-slot": "menu-item" });
    expect(
      actionItems.flatMap((item) => item.findAllByType("span").flatMap((span) => span.children)),
    ).toContain("Worktree dev");

    const editButton = renderer.root.findByProps({ "aria-label": "Edit Worktree dev" });
    act(() => {
      editButton.props.onClick({ preventDefault() {}, stopPropagation() {} });
    });
    expect(renderer.root.findByProps({ "data-testid": "editor-open" })).toBeDefined();
  });

  it("marks a starting action as busy and uses a reduced-motion-safe spinner", () => {
    renderer = renderControl({ startingScriptIds: new Set(["worktree-dev"]) });

    const runningItem = renderer.root.findAllByProps({
      "data-slot": "menu-item",
      "aria-busy": true,
    })[0];
    expect(runningItem).toBeDefined();
    const spinner = renderer.root.findByProps({ "data-icon": "loader" });
    expect(spinner.props.className).toContain("motion-safe:animate-spin");
    expect(spinner.props.className).toContain("motion-reduce:animate-none");
  });

  it("shows the completed running state with a stop control", () => {
    renderer = renderControl({ runningScriptIds: new Set(["build"]) });

    const runButton = renderer.root.findByProps({ "aria-label": "Stop Build" });
    expect(runButton.props.variant).toBe("destructive");
    expect(renderer.root.findByProps({ "aria-label": "Script actions" }).props.variant).toBe(
      "destructive",
    );
    expect(renderer.root.findAllByProps({ "data-icon": "square" })).not.toHaveLength(0);
    expect(runButton.props["aria-busy"]).toBe(false);
  });
});
