import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  preflight: vi.fn(),
  remove: vi.fn(),
  prepare: vi.fn(),
  replace: vi.fn(),
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
  issueEnvironment: {
    worktreePrepare: state.prepare,
    worktreeReplace: state.replace,
    link: state.link,
    worktreeDeletePreflight: state.preflight,
    worktreeDelete: state.remove,
  },
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
vi.mock("../ui/select", () => ({
  Select: "select",
  SelectTrigger: "label",
  SelectValue: "span",
  SelectPopup: "div",
  SelectItem: "option",
}));

import { IssueWorktreeDialog, type IssueWorktreeDialogProps } from "./IssueDetailPanel";

const reference = { projectId: ProjectId.make("project"), repository: "acme/repo", number: 142 };
const worktree = { branch: "issue-142", worktreePath: "/worktrees/issue-142" };
let renderer: ReactTestRenderer | undefined;

function dialog(props: Partial<IssueWorktreeDialogProps> = {}) {
  return (
    <IssueWorktreeDialog
      open
      onOpenChange={vi.fn()}
      environmentId={EnvironmentId.make("remote")}
      reference={reference}
      issueTitle="Fix checkout redirect"
      linkedWork={null}
      {...props}
    />
  );
}

async function renderDialog(canLink = true, props: Partial<IssueWorktreeDialogProps> = {}) {
  await act(async () => {
    renderer = create(dialog({ canLink, ...props }));
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
  it("uses the issue title when creating a worktree", async () => {
    await renderDialog(false);
    await clickCreate();
    expect(state.prepare.mock.calls[0]?.[0].input.name).toBe("Fix checkout redirect");
  });

  it("preserves a manual name across issue refreshes", async () => {
    await renderDialog(false);
    await act(async () => {
      renderer!.root.findAllByType("input")[0]!.props.onChange({ target: { value: "custom-fix" } });
    });
    await act(async () => {
      renderer!.update(dialog({ canLink: false, issueTitle: "Updated title" }));
    });
    await clickCreate();
    expect(state.prepare.mock.calls[0]?.[0].input.name).toBe("custom-fix");
  });

  it.each([
    { reference: { ...reference, number: 143 } },
    { reference: { ...reference, repository: "acme/other" } },
    { reference: { ...reference, host: "github.example.com" } },
    { reference: { ...reference, projectId: ProjectId.make("other") } },
    { environmentId: EnvironmentId.make("other") },
  ])("resets the name when the issue identity changes: %j", async (props) => {
    await renderDialog(false);
    await act(async () => {
      renderer!.update(dialog({ canLink: false, ...props, issueTitle: "Fix login" }));
    });
    await clickCreate();
    expect(state.prepare.mock.calls[0]?.[0].input.name).toBe("Fix login");
  });

  it("caps long titles to the worktree name contract", async () => {
    await renderDialog(false, { issueTitle: "x".repeat(200) });
    await clickCreate();
    expect(state.prepare.mock.calls[0]?.[0].input.name).toBe("x".repeat(128));
  });

  it("uses the title when replacing a linked worktree", async () => {
    state.replace.mockResolvedValue({ _tag: "Success", value: {} });
    await renderDialog(true, {
      linkedWork: {
        issue: {
          provider: "github",
          host: "github.com",
          repository: reference.repository,
          number: 142,
        },
        projectId: reference.projectId,
        threadId: ThreadId.make("thread"),
        linkedAt: "2026-09-26T00:00:00.000Z",
        source: "created",
        ...worktree,
      },
    });
    await act(async () => {
      renderer!.root
        .findAllByType("button")
        .find((button) =>
          button.props.children?.props?.children?.includes(" Replace linked worktree"),
        )!
        .props.onClick();
    });
    expect(state.replace.mock.calls[0]?.[0].input.name).toBe("Fix checkout redirect");
  });

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

describe("issue worktree deletion choices", () => {
  async function checkWorktree(issueState: "open" | "closed" | null = "open") {
    state.refs = [{ name: worktree.branch, worktreePath: worktree.worktreePath }];
    state.threads = [
      {
        id: "thread",
        environmentId: "remote",
        projectId: "project",
        worktreePath: worktree.worktreePath,
      },
    ];
    state.preflight.mockResolvedValue({
      _tag: "Success",
      value: {
        items: [
          {
            threadId: "thread",
            projectId: "project",
            path: worktree.worktreePath,
            branch: worktree.branch,
            blocked: false,
            changedFiles: [],
            unpushedCommitCount: 0,
            requiresForce: false,
            issues: [{ ...reference, state: issueState }],
          },
        ],
      },
    });
    state.remove.mockResolvedValue({
      _tag: "Success",
      value: {
        results: [
          {
            threadId: "thread",
            path: worktree.worktreePath,
            deleted: true,
            warnings: ["acme/repo#142 remains open. Closing failed."],
          },
        ],
      },
    });
    await renderDialog();
    await act(async () =>
      renderer!.root
        .findAllByType("input")
        .find((item) => item.props.onCheckedChange)!
        .props.onCheckedChange(true),
    );
    await act(async () =>
      renderer!.root
        .findAllByType("button")
        .find((item) => item.props.children?.props?.children?.includes("Check 1 before deleting"))!
        .props.onClick(),
    );
  }
  async function confirmDelete() {
    await act(async () =>
      renderer!.root
        .findAllByType("button")
        .find((item) => item.props.children === "Delete selected worktrees")!
        .props.onClick(),
    );
  }
  it.each(["completed", "not-planned"])(
    "submits %s only when selected and shows the failed-close warning after deletion",
    async (action) => {
      await checkWorktree();
      await act(async () => renderer!.root.findByType("select").props.onValueChange(action));
      await confirmDelete();
      expect(state.remove.mock.calls[0]?.[0]).toMatchObject({
        environmentId: "remote",
        input: { issueDecisions: [{ ...reference, action }] },
      });
      expect(JSON.stringify(renderer!.toJSON())).toContain("remains open. Closing failed.");
      expect(JSON.stringify(renderer!.toJSON())).toContain("Deleted");
    },
  );
  it("keeps open issues unchanged by default", async () => {
    await checkWorktree();
    await confirmDelete();
    expect(state.remove.mock.calls[0]?.[0].input.issueDecisions).toEqual([]);
  });
  it("allows a closed issue without a close decision", async () => {
    await checkWorktree("closed");
    expect(renderer!.root.findAllByType("select")).toHaveLength(0);
    await confirmDelete();
    expect(state.remove).toHaveBeenCalledOnce();
  });
  it("shows an explicit unchanged path for unknown issue state", async () => {
    await checkWorktree(null);
    expect(JSON.stringify(renderer!.toJSON())).toContain("Leave unchanged");
    await confirmDelete();
    expect(state.remove.mock.calls[0]?.[0].input.issueDecisions).toEqual([]);
  });
  it("requires a new preflight after the selected worktrees change", async () => {
    await checkWorktree();
    await act(async () =>
      renderer!.root
        .findAllByType("input")
        .find((item) => item.props.onCheckedChange)!
        .props.onCheckedChange(false),
    );
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("Delete selected worktrees");
    expect(state.remove).not.toHaveBeenCalled();
  });
});
