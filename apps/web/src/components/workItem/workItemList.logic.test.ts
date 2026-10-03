import { describe, expect, it } from "vite-plus/test";

import {
  nextWorkItemCursor,
  retainVisibleWorkItemSelection,
  selectWorkItemRange,
  toggleWorkItemSelection,
  workItemListCommand,
} from "./workItemList.logic";

const keys = ["a", "b", "c", "d", "e"];

describe("selectWorkItemRange", () => {
  it("adds every row between the anchor and the target in either direction", () => {
    expect([...selectWorkItemRange(keys, "b", "d", new Set())]).toEqual(["b", "c", "d"]);
    expect([...selectWorkItemRange(keys, "d", "b", new Set())].toSorted()).toEqual(["b", "c", "d"]);
  });

  it("keeps rows already selected outside the range", () => {
    expect([...selectWorkItemRange(keys, "c", "d", new Set(["a"]))].toSorted()).toEqual([
      "a",
      "c",
      "d",
    ]);
  });

  it("toggles the target alone when the anchor has left the list", () => {
    expect([...selectWorkItemRange(keys, "gone", "c", new Set(["c"]))]).toEqual([]);
    expect([...selectWorkItemRange(keys, null, "c", new Set())]).toEqual(["c"]);
  });

  it("ignores a target that is not on screen", () => {
    const selected = new Set(["a"]);
    expect(selectWorkItemRange(keys, "a", "zzz", selected)).toBe(selected);
  });
});

describe("work item selection", () => {
  it("toggles one key", () => {
    expect([...toggleWorkItemSelection(new Set(["a"]), "b")]).toEqual(["a", "b"]);
    expect([...toggleWorkItemSelection(new Set(["a"]), "a")]).toEqual([]);
  });

  it("drops rows that left the list and keeps identity when nothing did", () => {
    const selected = new Set(["a", "c"]);
    expect(retainVisibleWorkItemSelection(selected, keys)).toBe(selected);
    expect([...retainVisibleWorkItemSelection(selected, ["a", "b"])]).toEqual(["a"]);
  });
});

describe("nextWorkItemCursor", () => {
  it("starts at the near end and holds at the far ones", () => {
    expect(nextWorkItemCursor(keys, null, 1)).toBe("a");
    expect(nextWorkItemCursor(keys, null, -1)).toBe("e");
    expect(nextWorkItemCursor(keys, "e", 1)).toBe("e");
    expect(nextWorkItemCursor(keys, "a", -1)).toBe("a");
    expect(nextWorkItemCursor(keys, "b", 1)).toBe("c");
  });

  it("restarts when the cursor row is gone and has nothing to land on in an empty list", () => {
    expect(nextWorkItemCursor(keys, "gone", 1)).toBe("a");
    expect(nextWorkItemCursor([], null, 1)).toBeNull();
  });
});

describe("workItemListCommand", () => {
  const press = (key: string, overrides: Partial<Parameters<typeof workItemListCommand>[0]> = {}) =>
    workItemListCommand({
      key,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      typing: false,
      listFocused: false,
      ...overrides,
    });

  it("maps the letter keys anywhere on the page", () => {
    expect(press("j")).toBe("next");
    expect(press("k")).toBe("previous");
    expect(press("x")).toBe("toggle");
    expect(press("c")).toBe("create");
  });

  it("only takes the arrows once the list has focus", () => {
    expect(press("ArrowDown")).toBeNull();
    expect(press("ArrowDown", { listFocused: true })).toBe("next");
    expect(press("ArrowUp", { listFocused: true })).toBe("previous");
  });

  it("leaves keys alone while typing or with modifiers", () => {
    expect(press("j", { typing: true })).toBeNull();
    expect(press("j", { metaKey: true })).toBeNull();
    expect(press("j", { shiftKey: true })).toBeNull();
    expect(press("c", { altKey: true })).toBeNull();
  });

  it("selects all with Mod+A only from inside the list", () => {
    expect(press("a", { metaKey: true })).toBeNull();
    expect(press("a", { metaKey: true, listFocused: true })).toBe("select-all");
    expect(press("A", { ctrlKey: true, listFocused: true })).toBe("select-all");
    expect(press("a", { metaKey: true, listFocused: true, typing: true })).toBeNull();
  });
});
