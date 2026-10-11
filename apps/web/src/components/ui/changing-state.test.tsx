import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const settings = vi.hoisted(() => ({ active: true, durationMs: 150 }));
vi.mock("../../uiAnimations", () => ({ useUiAnimationSettings: () => settings }));

import { AnimatedIcon, AnimatedText } from "./changing-state";

let renderer: ReactTestRenderer;
beforeEach(() => {
  settings.active = true;
});
afterEach(() => {
  act(() => renderer?.unmount());
});

function renderText(value: string, changeKey = "thread") {
  act(() => {
    const element = <AnimatedText value={value} changeKey={changeKey} />;
    if (renderer?.toJSON()) renderer.update(element);
    else renderer = create(element);
  });
}
function finishExit(outgoing = renderer.root.findByProps({ "data-changing-text": "outgoing" })) {
  act(() => outgoing.props.onAnimationComplete());
}
function visibleLetters() {
  return renderer.root
    .findAllByType("span")
    .filter((node) => node.props.className === "changing-text-letter")
    .map((node) => node.children.join(""));
}

describe("changing-state motion", () => {
  it("animates a rename within the same thread and releases letters after the transition", () => {
    renderText("First thread");
    expect(visibleLetters()).toEqual([]);
    renderText("Second thread");
    expect(renderer.root.findByProps({ "data-changing-text": "outgoing" }).props.children).toBe(
      "First thread",
    );
    expect(visibleLetters().join("")).toBe("Second thread");
    finishExit();
    expect(renderer.root.findAllByProps({ "data-changing-text": "outgoing" })).toHaveLength(0);
    expect(visibleLetters()).toEqual([]);
    expect(renderer.root.findByProps({ "data-changing-text": "incoming" }).children).toEqual([
      "Second thread",
    ]);
  });

  it("keeps only the latest transition when thread changes interrupt one another", () => {
    renderText("First", "1");
    renderText("Second", "2");
    const staleExit = renderer.root.findByProps({ "data-changing-text": "outgoing" }).props
      .onAnimationComplete;
    renderText("Third", "3");
    act(() => staleExit());
    expect(renderer.root.findByProps({ "data-changing-text": "outgoing" }).props.children).toBe(
      "Second",
    );
    expect(visibleLetters().join("")).toBe("Third");
    finishExit();
    expect(renderer.root.findAllByProps({ "data-changing-text": "outgoing" })).toHaveLength(0);
  });

  it("keeps combining characters and emoji intact", () => {
    renderText("First");
    renderText("e\u0301👨‍👩‍👧‍👦!");
    expect(visibleLetters()).toEqual(["e\u0301", "👨‍👩‍👧‍👦", "!"]);
  });

  it.each(["مرحبا", "a".repeat(121)])(
    "keeps joined scripts and long labels in one run",
    (value) => {
      renderText("First");
      renderText(value);
      expect(visibleLetters()).toEqual([value]);
    },
  );

  it("immediately settles an active transition when animation is disabled", () => {
    renderText("First");
    renderText("Second");
    settings.active = false;
    renderText("Third");
    expect(renderer.root.findAllByProps({ "data-changing-text": "outgoing" })).toHaveLength(0);
    expect(visibleLetters()).toEqual([]);
    expect(renderer.root.findByProps({ "data-changing-text": "incoming" }).children).toEqual([
      "Third",
    ]);
  });

  it("updates icon contents even when the state key remains the same", () => {
    act(() => {
      renderer = create(
        <AnimatedIcon stateKey="ready">
          <span>First</span>
        </AnimatedIcon>,
      );
    });
    act(() => {
      renderer.update(
        <AnimatedIcon stateKey="ready">
          <span>Updated</span>
        </AnimatedIcon>,
      );
    });
    expect(
      renderer.root.findAllByType("span").some((node) => node.children.includes("Updated")),
    ).toBe(true);
  });
});
