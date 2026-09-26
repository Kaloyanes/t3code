import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  prepare: vi.fn(),
  create: vi.fn(),
  link: vi.fn(),
  newThread: vi.fn(),
  refresh: vi.fn(),
  loadNext: vi.fn(),
  threads: [] as Array<Record<string, unknown>>,
  refs: [] as Array<{ name: string; worktreePath: string | null }>,
  saved: new Map<string, { branch: string; worktreePath: string }>(),
}));

vi.mock("@effect/atom-react", () => ({ useAtomValue: (value: unknown) => value }));
vi.mock("~/state/server", () => ({
  serverEnvironment: {
    providersValueAtom: () => [
      {
        instanceId: ProviderInstanceId.make("codex"),
        driver: ProviderDriverKind.make("codex"),
        enabled: true,
        installed: true,
        version: null,
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: "2026-09-26T00:00:00.000Z",
        models: [{ slug: "test-model", name: "Test model", capabilities: {} }],
        slashCommands: [],
        skills: [],
      },
    ],
  },
}));

vi.mock("~/state/issues", () => ({
  issueEnvironment: { worktreePrepare: state.prepare, link: state.link },
  useIssueCandidates: vi.fn(),
  useIssueComments: vi.fn(),
  useIssueDetail: vi.fn(),
}));
vi.mock("~/state/threads", () => ({ threadEnvironment: { create: state.create } }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
vi.mock("~/state/entities", () => ({
  useThreadShells: () => state.threads,
  useProject: () => ({ id: "project", workspaceRoot: "/repo" }),
}));
vi.mock("~/state/queries", () => ({
  usePaginatedBranches: () => ({
    refs: state.refs,
    data: { nextCursor: 100 },
    isPending: false,
    error: null,
    refresh: state.refresh,
    loadNext: state.loadNext,
  }),
}));
vi.mock("~/hooks/useSettings", () => ({ useEnvironmentSettings: () => DEFAULT_SERVER_SETTINGS }));
vi.mock("~/hooks/useHandleNewThread", () => ({ useNewThreadHandler: () => state.newThread }));
vi.mock("~/state/shell", () => ({ refreshEnvironmentShell: vi.fn() }));
vi.mock("~/localApi", () => ({ readLocalApi: vi.fn() }));
vi.mock("../ChatMarkdown", () => ({ default: "markdown" }));
vi.mock("../ui/dialog", () => ({
  Dialog: "dialog",
  DialogPopup: "div",
  DialogHeader: "header",
  DialogTitle: "h2",
  DialogDescription: "p",
  DialogPanel: "section",
  DialogFooter: "footer",
}));
vi.mock("../ui/button", () => ({ Button: "button" }));
vi.mock("../ui/checkbox", () => ({ Checkbox: "input" }));
vi.mock("../ui/input", () => ({ Input: "input" }));

import { IssueWorktreeDialog } from "./IssueDetailPanel";

const reference = { projectId: ProjectId.make("project"), repository: "acme/repo", number: 142 };
const worktree = { branch: "issue-142", worktreePath: "/worktrees/issue-142" };
let renderer: ReactTestRenderer | undefined;

async function renderDialog(canLink = true) {
  await act(async () => {
    renderer = create(
      <IssueWorktreeDialog
        open
        onOpenChange={vi.fn()}
        environmentId={EnvironmentId.make("remote")}
        reference={reference}
        linkedWork={null}
        canLink={canLink}
      />,
    );
  });
  return renderer!;
}

async function clickCreate() {
  const button = renderer!.root.findAllByType("button").find((item) => !item.props.variant)!;
  await act(async () => {
    button.props.onClick();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.saved.clear();
  state.threads = [];
  state.refs = [];
  state.prepare.mockImplementation(async ({ input }) => {
    if (input.threadId && !state.saved.has(input.threadId))
      throw new Error("Thread does not belong to this project.");
    return { _tag: "Success", value: { worktree, linkedWork: null } };
  });
  state.create.mockImplementation(async ({ input }) => {
    state.saved.set(input.threadId, { branch: input.branch, worktreePath: input.worktreePath });
    return { _tag: "Success", value: {} };
  });
  state.link.mockImplementation(async ({ input }) => {
    const saved = state.saved.get(input.threadId);
    if (!saved) throw new Error("Thread does not belong to this project.");
    return { _tag: "Success", value: { linkedWork: saved } };
  });
  state.newThread.mockResolvedValue({ threadId: "unsaved-draft", draftId: "draft" });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
});

describe("IssueWorktreeDialog", () => {
  it("creates a worktree and links it through a saved thread without navigating to a draft", async () => {
    await renderDialog();
    await clickCreate();
    expect([...state.saved.values()]).toEqual([worktree]);
    expect(state.create.mock.calls[0]?.[0].input.modelSelection).toEqual({
      instanceId: "codex",
      model: "test-model",
    });
    expect(state.link).toHaveBeenCalledWith({
      environmentId: "remote",
      input: { ...reference, threadId: expect.any(String), source: "created" },
    });
    expect(state.refresh).toHaveBeenCalled();
    expect(state.newThread).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer!.toJSON())).toContain("Worktree created and linked.");
  });

  it("leaves creation errors visible without opening or saving a thread", async () => {
    state.prepare.mockRejectedValue(new Error("Base branch does not exist"));
    await renderDialog();
    await clickCreate();
    expect(state.saved.size).toBe(0);
    expect(state.newThread).not.toHaveBeenCalled();
    expect(state.link).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer!.toJSON())).toContain("Base branch does not exist");
  });

  it("can create without linking or saving a thread", async () => {
    await renderDialog(false);
    await clickCreate();
    expect(state.saved.size).toBe(0);
    expect(state.link).not.toHaveBeenCalled();
    expect(state.refresh).toHaveBeenCalled();
    expect(JSON.stringify(renderer!.toJSON())).toContain("Worktree created.");
  });

  it("lists Git worktrees once with their paths, independent of thread titles", async () => {
    state.refs = [
      { name: "main", worktreePath: "/repo" },
      { name: "feature", worktreePath: "/worktrees/feature" },
      { name: "feature-alias", worktreePath: "/worktrees/feature" },
      { name: "unused-branch", worktreePath: null },
    ];
    state.threads = [1, 2].map((id) => ({
      id: `thread-${id}`,
      environmentId: "remote",
      projectId: "project",
      title: `Thread title ${id}`,
      worktreePath: "/worktrees/feature",
    }));
    const view = await renderDialog();
    const content = JSON.stringify(view.toJSON());
    expect(content).toContain("/worktrees/feature");
    expect(content).not.toContain("Thread title");
    expect(
      view.root.findAllByType("input").filter((item) => item.props.onCheckedChange),
    ).toHaveLength(1);
    expect(state.loadNext).toHaveBeenCalled();
  });

  it("links a worktree with no existing thread using a persisted workspace", async () => {
    state.refs = [{ name: worktree.branch, worktreePath: worktree.worktreePath }];
    const view = await renderDialog();
    const button = view.root
      .findAllByType("button")
      .find((item) => item.props["aria-label"]?.startsWith("Link issue"))!;
    await act(async () => {
      button.props.onClick();
    });
    expect([...state.saved.values()]).toEqual([worktree]);
    expect(state.link).toHaveBeenCalled();
    expect(state.newThread).not.toHaveBeenCalled();
    expect(JSON.stringify(view.toJSON())).toContain("Issue linked to this worktree.");
  });
});
