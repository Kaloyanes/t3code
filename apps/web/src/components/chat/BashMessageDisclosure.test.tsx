import { act } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { BashMessageDisclosure } from "./BashMessageDisclosure";

describe("Bash message disclosure", () => {
  let renderer: ReactTestRenderer;
  beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
  afterEach(async () => {
    if (renderer) await act(() => renderer.unmount());
    vi.unstubAllGlobals();
  });

  it("leaves ordinary and unconfirmed messages unchanged", async () => {
    await act(() => {
      renderer = create(
        <BashMessageDisclosure command={undefined}>
          <p>!ls</p>
        </BashMessageDisclosure>,
      );
    });
    expect(renderer.root.findAllByType("button")).toHaveLength(0);
    expect(renderer.root.findByType("p").children).toEqual(["!ls"]);
  });

  const textOf = (node: ReactTestInstance | string): string =>
    typeof node === "string" ? node : node.children.map(textOf).join("");
  const resultText = () => textOf(renderer.root.findByType("pre"));

  it("shows stdout and stderr inline and collapses on demand", async () => {
    await act(() => {
      renderer = create(
        <BashMessageDisclosure
          command={{ status: "failed", output: "Exit code: 1\nstdout:\nbuilding\nstderr:\nboom" }}
        >
          <p>!build</p>
        </BashMessageDisclosure>,
      );
    });
    const button = renderer.root.findByType("button");
    expect(button.props["aria-expanded"]).toBe(true);
    expect(resultText()).toContain("building");
    expect(resultText()).toContain("boom");
    expect(resultText()).not.toContain("stdout:");
    await act(() => button.props.onClick());
    expect(button.props["aria-expanded"]).toBe(false);
    expect(renderer.root.findByProps({ id: button.props["aria-controls"] }).props.inert).toBe(true);
  });

  it("updates a running command with the server result", async () => {
    await act(() => {
      renderer = create(
        <BashMessageDisclosure command={{ status: "running", output: null }}>
          !ls
        </BashMessageDisclosure>,
      );
    });
    expect(renderer.root.findByType("p").children).toEqual(["Running command…"]);
    await act(() =>
      renderer.update(
        <BashMessageDisclosure
          command={{ status: "completed", output: "Exit code: 0\nstdout:\nfile.txt" }}
        >
          !ls
        </BashMessageDisclosure>,
      ),
    );
    expect(resultText()).toContain("file.txt");
    expect(renderer.root.findByProps({ role: "status" }).props["aria-label"]).toBe(
      "Bash · Completed",
    );
  });
});
