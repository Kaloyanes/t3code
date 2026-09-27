import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
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

  it.each(["completed", "failed"] as const)(
    "expands and collapses a %s command result",
    async (status) => {
      const output =
        status === "completed" ? "Exit code: 0\nfile.txt" : "Exit code: 1\nBuild failed";
      await act(() => {
        renderer = create(
          <BashMessageDisclosure command={{ status, output }}>
            <p>!build</p>
          </BashMessageDisclosure>,
        );
      });
      const button = renderer.root.findByType("button");
      expect(button.props["aria-expanded"]).toBe(false);
      expect(renderer.root.findAllByType("pre")).toHaveLength(0);
      await act(() => button.props.onClick());
      expect(button.props["aria-expanded"]).toBe(true);
      expect(renderer.root.findByType("pre").children).toEqual([output]);
      expect(renderer.root.findByProps({ id: button.props["aria-controls"] }).props.hidden).toBe(
        false,
      );
      await act(() => button.props.onClick());
      expect(button.props["aria-expanded"]).toBe(false);
      expect(renderer.root.findAllByType("pre")).toHaveLength(0);
    },
  );

  it("updates an open running command with the server result", async () => {
    await act(() => {
      renderer = create(
        <BashMessageDisclosure command={{ status: "running", output: null }}>
          !true
        </BashMessageDisclosure>,
      );
    });
    await act(() => renderer.root.findByType("button").props.onClick());
    expect(renderer.root.findByType("pre").children).toEqual(["Running command…"]);
    await act(() =>
      renderer.update(
        <BashMessageDisclosure
          command={{ status: "completed", output: "Exit code: 0\n(no output)" }}
        >
          !true
        </BashMessageDisclosure>,
      ),
    );
    expect(renderer.root.findByType("button").props["aria-expanded"]).toBe(true);
    expect(renderer.root.findByType("pre").children).toEqual(["Exit code: 0\n(no output)"]);
    expect(renderer.root.findByProps({ role: "status" }).children).toEqual(["Bash · Completed"]);
  });
});
