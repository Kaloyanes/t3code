import { describe, expect, it } from "vite-plus/test";

import { uiAnimationsActive } from "./uiAnimations";

describe("UI animation settings", () => {
  it("treats 0 ms and the system reduced-motion preference as reduced motion", () => {
    expect(uiAnimationsActive(0, false)).toBe(false);
    expect(uiAnimationsActive(150, true)).toBe(false);
    expect(uiAnimationsActive(150, false)).toBe(true);
  });
});
