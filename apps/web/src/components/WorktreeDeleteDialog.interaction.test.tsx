import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const commands = vi.hoisted(() => ({ preflight: vi.fn(), status: vi.fn() }));
vi.mock("../state/issues", () => ({
  issueEnvironment: { worktreeDeletePreflight: commands.preflight },
}));
vi.mock("../state/vcs", () => ({ vcsEnvironment: { refreshStatus: commands.status } }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
vi.mock("./ui/alert-dialog", () => ({
  AlertDialog: "dialog",
  AlertDialogClose: "cancel",
  AlertDialogDescription: "p",
  AlertDialogFooter: "footer",
  AlertDialogHeader: "header",
  AlertDialogPopup: "section",
  AlertDialogTitle: "h2",
}));
vi.mock("./ui/button", () => ({ Button: "button" }));
vi.mock("./ui/select", () => ({
  Select: "select",
  SelectTrigger: "label",
  SelectValue: "span",
  SelectPopup: "div",
  SelectItem: "option",
}));
import { WorktreeDeleteDialog } from "./WorktreeDeleteDialog";

const issue = {
  projectId: ProjectId.make("project"),
  host: "github.com",
  repository: "owner/repo",
  number: 42,
  state: "open",
};
const selection = {
  projectId: issue.projectId,
  threadId: ThreadId.make("thread"),
  path: "/worktrees/feature",
};
let renderer: ReactTestRenderer | undefined;
const confirm = vi.fn();
const close = vi.fn();
async function renderDialog() {
  await act(async () => {
    renderer = create(
      <WorktreeDeleteDialog
        environmentId={EnvironmentId.make("remote")}
        path={selection.path}
        label="feature"
        threadCount={2}
        issueSelection={selection}
        onConfirm={confirm}
        onClose={close}
      />,
    );
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  commands.status.mockResolvedValue({
    _tag: "Success",
    value: { isRepo: true, hasWorkingTreeChanges: false, hasUpstream: true, aheadCount: 3 },
  });
  commands.preflight.mockResolvedValue({
    _tag: "Success",
    value: { items: [{ ...selection, blocked: false, issues: [issue] }] },
  });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
});

describe("sidebar worktree deletion confirmation", () => {
  it("loads issues on the owning environment and keeps unpushed commits on the branch", async () => {
    await renderDialog();
    expect(commands.preflight).toHaveBeenCalledWith({
      environmentId: "remote",
      input: { selections: [selection] },
    });
    const button = renderer!.root.findByType("button");
    expect(button.props.disabled).toBe(false);
    await act(async () => button.props.onClick());
    expect(confirm).toHaveBeenCalledWith([]);
    expect(
      renderer!.root
        .findAllByType("span")
        .some((node) =>
          node.children.some(
            (child) => typeof child === "string" && child.includes("remain on the branch"),
          ),
        ),
    ).toBe(true);
  });
  it("submits a selected close reason", async () => {
    await renderDialog();
    await act(async () => renderer!.root.findByType("select").props.onValueChange("not-planned"));
    await act(async () => renderer!.root.findByType("button").props.onClick());
    expect(confirm).toHaveBeenCalledWith([
      expect.objectContaining({ number: 42, action: "not-planned" }),
    ]);
  });
  it("cancel does not submit issue decisions", async () => {
    await renderDialog();
    await act(async () => renderer!.root.findByType("dialog").props.onOpenChange(false));
    expect(close).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
  });
  it("blocks deletion when a sibling is active even without a server reason", async () => {
    commands.preflight.mockResolvedValue({
      _tag: "Success",
      value: { items: [{ ...selection, blocked: true, reason: null }] },
    });
    await renderDialog();
    expect(renderer!.root.findByType("button").props.disabled).toBe(true);
    expect(
      renderer!.root
        .findAllByType("span")
        .some((node) => node.children.includes("Worktree deletion is blocked.")),
    ).toBe(true);
  });
});
