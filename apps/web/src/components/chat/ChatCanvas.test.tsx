// @vitest-environment jsdom

import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { ChatCanvas } from "./ChatCanvas";
import { useChatCanvas } from "./ChatCanvasContext";
import { publishUiAnimationSettings } from "../../uiAnimations";

const resize = vi.hoisted(() => ({ callbacks: new Set<() => void>() }));
vi.mock("../../lib/observeResize", () => ({
  observeResize: (_elements: unknown, callback: () => void) => {
    resize.callbacks.add(callback);
    return () => resize.callbacks.delete(callback);
  },
}));

let root: Root;
let container: HTMLDivElement;
let fontSize = 16;
let canvas: ReturnType<typeof useChatCanvas>;

function Preview({ x }: { x: number }) {
  const current = useChatCanvas();
  useLayoutEffect(() => {
    canvas = current;
  }, [current]);
  const reportPreview = current?.reportPreview;
  useLayoutEffect(() => {
    reportPreview?.({
      key: "browser:one",
      width: 240,
      source: { width: 240, height: 365 },
      position: { x, y: 12 },
      lastInteraction: "drag",
    });
  }, [reportPreview, x]);
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fontSize = 16;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    // A nonzero canvas origin catches viewport coordinates used as canvas coordinates.
    if (this.hasAttribute("data-thread-find-bar")) {
      const gap = 0.75 * fontSize;
      return new DOMRect(
        200 + 1800 - gap - 17.5 * fontSize,
        100 + gap,
        17.5 * fontSize,
        2.25 * fontSize,
      );
    }
    return new DOMRect(200, 100, 1800, 1000);
  });
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    paddingLeft: "48px",
    width: "736px",
    minWidth: "640px",
  } as CSSStyleDeclaration);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  resize.callbacks.clear();
  publishUiAnimationSettings({ active: false, durationMs: 0 });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderFind(open: boolean, previewX = 1548) {
  await act(() =>
    root.render(
      <ChatCanvas composerOverlayElement={null} detailsCardTopInset={open ? 48 : 0}>
        {open ? <div data-thread-find-bar /> : null}
        <Preview x={previewX} />
      </ChatCanvas>,
    ),
  );
}

it.each([16, 24])(
  "keeps a preview below Find and releases its space on close at a %spx root font",
  async (size) => {
    fontSize = size;
    await renderFind(false);
    expect(canvas?.layout.frame?.y).toBe(12);

    await renderFind(true);
    expect(canvas?.detailsCardTopInset).toBe(3 * size);
    expect(canvas?.layout.frame?.y).toBe(3 * size + 12);

    await renderFind(false);
    expect(canvas?.detailsCardTopInset).toBe(0);
    expect(canvas?.layout.frame?.y).toBe(12);

    await renderFind(true);
    expect(canvas?.layout.frame?.y).toBe(3 * size + 12);
  },
);

it("remeasures the open bar when its font size changes without resizing the canvas", async () => {
  await renderFind(true, 1200);
  expect(canvas?.layout.frame?.y).toBe(12);

  fontSize = 24;
  await act(() => {
    for (const callback of resize.callbacks) callback();
  });
  expect(canvas?.detailsCardTopInset).toBe(72);
  expect(canvas?.layout.frame?.y).toBe(84);
});

async function renderAnimatedLane() {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => frames.push(callback));
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  publishUiAnimationSettings({ active: true, durationMs: 150 });
  await act(() =>
    root.render(
      <ChatCanvas composerOverlayElement={null} navigationKey="thread-one">
        <div data-chat-composer-stack="true" />
        <Preview x={1548} />
      </ChatCanvas>,
    ),
  );
  await act(() => {
    for (const frame of frames.splice(0)) frame(0);
  });
  await act(() => {
    for (const frame of frames.splice(0)) frame(16);
  });
  const element = container.querySelector<HTMLElement>("[data-chat-composer-stack]");
  if (!element) throw new Error("Composer did not mount");
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ finished: new Promise<void>(() => {}), cancel }));
  Object.defineProperty(element, "animate", { value: animate });
  return { element, animate, cancel };
}

it("keeps the composer at its previous position when details move the chat lane", async () => {
  const { animate } = await renderAnimatedLane();
  await act(() => canvas?.reportDetailsCard({ left: 1200, right: 1480, bottom: 300 }));
  expect(canvas?.layout.chat.left).toBe(432);
  expect(animate).toHaveBeenCalledWith(
    [{ transform: "translateX(100px)" }, { transform: "translateX(0px)" }],
    expect.objectContaining({ duration: 150 }),
  );
});

it("reverses from the current visual position when details close mid-animation", async () => {
  const { element, animate, cancel } = await renderAnimatedLane();
  await act(() => canvas?.reportDetailsCard({ left: 1200, right: 1480, bottom: 300 }));
  const probeStyles = document.createElement("div").style;
  probeStyles.paddingLeft = "48px";
  probeStyles.width = "736px";
  probeStyles.minWidth = "640px";
  element.style.transform = "matrix(1, 0, 0, 1, 45, 0)";
  vi.mocked(window.getComputedStyle).mockImplementation((subject) =>
    subject === element ? element.style : probeStyles,
  );
  vi.stubGlobal(
    "DOMMatrixReadOnly",
    class {
      readonly m41: number;
      constructor(transform: string) {
        this.m41 = Number(transform.slice(7, -1).split(",")[4]);
      }
    },
  );
  await act(() => canvas?.reportDetailsCard(null));
  expect(cancel).toHaveBeenCalledOnce();
  expect(animate).toHaveBeenLastCalledWith(
    [{ transform: "translateX(-55px)" }, { transform: "translateX(0px)" }],
    expect.objectContaining({ duration: 150 }),
  );
});
