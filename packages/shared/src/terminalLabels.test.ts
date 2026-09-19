import { describe, expect, it } from "vite-plus/test";

import type { TerminalSummary } from "@t3tools/contracts";
import { DEFAULT_TERMINAL_ID } from "@t3tools/contracts";

import { getTerminalLabel, nextTerminalId, resolveTerminalSessionLabel } from "./terminalLabels.ts";

describe("getTerminalLabel", () => {
  it("distinguishes the shared Run terminal from isolated terminals", () => {
    expect(getTerminalLabel(DEFAULT_TERMINAL_ID)).toBe("Run");
    expect(getTerminalLabel("term-2")).toBe("Terminal 2");
    expect(getTerminalLabel("term-12")).toBe("Terminal 12");
    expect(getTerminalLabel("terminal-3")).toBe("Terminal 3");
  });

  it("falls back to the raw id for unknown shapes", () => {
    expect(getTerminalLabel("custom-session")).toBe("custom-session");
  });
});

describe("resolveTerminalSessionLabel", () => {
  it("prefers a non-empty summary label", () => {
    const summary = { label: "  bun  " } as Pick<TerminalSummary, "label">;
    expect(resolveTerminalSessionLabel("term-2", summary)).toBe("bun");
  });

  it("keeps the Run label stable while allowing isolated terminal process labels", () => {
    expect(resolveTerminalSessionLabel(DEFAULT_TERMINAL_ID, { label: "pnpm" })).toBe("Run");
    expect(resolveTerminalSessionLabel(DEFAULT_TERMINAL_ID, { label: "   " })).toBe("Run");
    expect(resolveTerminalSessionLabel(DEFAULT_TERMINAL_ID, null)).toBe("Run");
    expect(resolveTerminalSessionLabel("term-2", undefined)).toBe("Terminal 2");
    expect(resolveTerminalSessionLabel("term-2", { label: "vite" })).toBe("vite");
  });
});

describe("nextTerminalId", () => {
  it("allocates term-1 when no terminals are listed yet", () => {
    expect(nextTerminalId([])).toBe(DEFAULT_TERMINAL_ID);
  });

  it("allocates term-2 when only term-1 exists", () => {
    expect(nextTerminalId([DEFAULT_TERMINAL_ID])).toBe("term-2");
  });

  it("skips over taken term-N slots", () => {
    expect(nextTerminalId([DEFAULT_TERMINAL_ID, "term-2", "term-3"])).toBe("term-4");
    expect(nextTerminalId([DEFAULT_TERMINAL_ID, "term-3"])).toBe("term-2");
    expect(nextTerminalId(["term-2", "term-3"])).toBe("term-1");
  });

  it("ignores blank/whitespace-only ids", () => {
    expect(nextTerminalId(["", "  ", DEFAULT_TERMINAL_ID])).toBe("term-2");
    expect(nextTerminalId(["", "  "])).toBe("term-1");
  });
});
