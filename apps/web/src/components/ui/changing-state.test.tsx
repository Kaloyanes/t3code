import { act } from "react";
import { create } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../uiAnimations", () => ({
  useUiAnimationSettings: () => ({ active: true, durationMs: 150 }),
}));

import { AnimatedText } from "./changing-state";

describe("changing-state motion", () => {
  it("keeps the outgoing breadcrumb text until its exit animation finishes", () => {
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<AnimatedText value="First thread" changeKey="thread:first" />);
    });
    act(() => {
      renderer.update(<AnimatedText value="Second thread" changeKey="thread:second" />);
    });

    const outgoing = renderer.root.findByProps({ "data-changing-text": "outgoing" });
    const incoming = renderer.root.findByProps({ "data-changing-text": "incoming" });
    expect(outgoing.children).toEqual(["First thread"]);
    expect(incoming.children).toEqual(["Second thread"]);

    act(() => outgoing.props.onAnimationEnd());
    expect(renderer.root.findAllByProps({ "data-changing-text": "outgoing" })).toHaveLength(0);
  });
});
