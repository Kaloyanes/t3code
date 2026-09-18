import { EnvironmentId, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import {
  StrictMode,
  act,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  presentations: new Map(),
  popoverOpen: false,
  openPopover: () => {},
  refreshProviders: vi.fn(async () => ({ _tag: "Success", value: {} })),
  refreshUsageLimits: vi.fn(async (_environmentId, refresh: () => Promise<unknown>) => refresh()),
  consumeResetCredit: vi.fn(async (): Promise<unknown> => ({
    _tag: "Success" as const,
    value: { outcome: "reset" as const },
  })),
  toast: vi.fn(),
}));

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => state.presentations }));
vi.mock("@t3tools/client-runtime/state/usage", () => ({
  refreshUsageLimits: state.refreshUsageLimits,
}));
vi.mock("../../state/presentation", () => ({
  environmentPresentations: { presentationsAtom: null },
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: { refreshProviders: "refresh", consumeResetCredit: "consume" },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: string) =>
    command === "refresh" ? state.refreshProviders : state.consumeResetCredit,
}));
vi.mock("../ui/toast", () => ({ toastManager: { add: state.toast } }));
vi.mock("../ui/button", () => ({ Button: "button" }));
vi.mock("../ui/refresh-icon", () => ({ RefreshIcon: "span" }));
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipPopup: () => null,
  TooltipTrigger: ({ children, render }: { children?: ReactNode; render?: ReactNode }) =>
    isValidElement(render)
      ? cloneElement(render as ReactElement<{ children?: ReactNode }>, { children })
      : children,
}));
vi.mock("../ui/popover", () => ({
  Popover: ({
    children,
    open,
    onOpenChange,
  }: {
    children: ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => {
    state.popoverOpen = open;
    state.openPopover = () => onOpenChange(true);
    return children;
  },
  PopoverTrigger: ({ render }: { render: ReactNode }) => render,
  PopoverPopup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));
vi.mock("./ProviderInstanceIcon", () => ({ ProviderInstanceIcon: () => null }));
vi.mock("../settings/RedactedSensitiveText", () => ({
  RedactedSensitiveText: ({ value }: { value: string }) => <span>{value}</span>,
}));
vi.mock("../settings/providerDriverMeta", () => ({
  DRIVER_OPTIONS: [
    { value: "codex", label: "Codex" },
    { value: "claudeAgent", label: "Claude" },
  ],
  getDriverOption: (driver: string) =>
    driver === "codex"
      ? { value: driver, label: "Codex" }
      : driver === "claudeAgent"
        ? { value: driver, label: "Claude" }
        : undefined,
}));
vi.mock("../usage/UsageLimits", () => ({
  LimitWindows: ({ windows }: { windows: readonly { label: string; usedPercent: number }[] }) => (
    <div>
      {windows.map((window) => `${window.label} ${100 - window.usedPercent}% left`).join(" ")}
    </div>
  ),
  resetCreditsSummary: (credits: { availableCount: number }) => `${credits.availableCount} banked`,
  ResetCreditDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) =>
    open ? <button onClick={onConfirm}>Confirm reset</button> : null,
}));

import { HeaderUsageLimitsPopover, groupLimitAccounts } from "./HeaderUsageLimitsPopover";

const checkedAt = "2026-09-18T10:00:00.000Z";
const limits = (usedPercent: number, resetCredits?: { availableCount: number }) => ({
  checkedAt,
  windows: [
    {
      id: "session",
      kind: "session" as const,
      label: "Session",
      usedPercent,
      resetsAt: "2026-09-18T12:00:00.000Z",
      windowDurationMins: 300,
    },
  ],
  ...(resetCredits ? { resetCredits } : {}),
});

function provider(input: {
  instanceId: string;
  driver?: "codex" | "claudeAgent";
  email?: string;
  displayName?: string;
  usedPercent: number;
  resetCredits?: { availableCount: number };
}) {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverKind.make(input.driver ?? "codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready" as const,
    auth: { status: "authenticated" as const, email: input.email },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    displayName: input.displayName,
    usageLimits: limits(input.usedPercent, input.resetCredits),
  };
}

function presentation(
  label: string,
  providers: readonly ReturnType<typeof provider>[],
  connection: "connected" | "disconnected" = "connected",
  usageLimitSources: readonly unknown[] = [],
) {
  return {
    entry: { target: { label } },
    connection: { phase: connection },
    serverConfig: { providers, usageLimitSources },
  };
}

let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-18T10:30:00.000Z"));
  state.presentations = new Map();
  state.popoverOpen = false;
  state.refreshProviders.mockClear();
  state.refreshUsageLimits.mockClear();
  state.consumeResetCredit.mockClear();
  state.toast.mockClear();
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render() {
  await act(() => {
    renderer = create(
      <StrictMode>
        <HeaderUsageLimitsPopover />
      </StrictMode>,
    );
  });
}

function renderedText(): string {
  return JSON.stringify(renderer.toJSON(), (key, value) => (key === "props" ? undefined : value));
}

describe("groupLimitAccounts", () => {
  it("uses provider order and sorts accounts by their visible identity", () => {
    const account = (key: string, driver: "codex" | "claudeAgent", displayName: string) => ({
      key,
      driver: ProviderDriverKind.make(driver),
      displayName,
      email: undefined,
      plan: undefined,
      accentColor: undefined,
      environments: [],
      sourceLabel: null,
      redeem: null,
      limits: limits(20),
    });
    const groups = groupLimitAccounts([
      account("claude", "claudeAgent", "Claude"),
      account("z", "codex", "Zulu"),
      account("a", "codex", "Alpha"),
    ]);
    expect(groups.map((group) => group.label)).toEqual(["Codex", "Claude"]);
    expect(groups[0]?.accounts.map((item) => item.displayName)).toEqual(["Alpha", "Zulu"]);
  });
});

it("shows distinct native and hub accounts across providers and keeps source notices", async () => {
  const source = {
    id: "hub",
    kind: "cliproxy" as const,
    label: "Account pool",
    checkedAt,
    accounts: [
      {
        id: "hub-only",
        driver: ProviderDriverKind.make("codex"),
        email: "pool@example.com",
        usageLimits: limits(10),
      },
    ],
    error: "One account could not be read.",
  };
  state.presentations = new Map([
    [
      EnvironmentId.make("laptop"),
      presentation("Laptop", [
        provider({
          instanceId: "codex-laptop",
          email: "same@example.com",
          displayName: "Personal",
          usedPercent: 40,
        }),
      ]),
    ],
    [
      EnvironmentId.make("server"),
      presentation(
        "Server",
        [
          provider({
            instanceId: "codex-server",
            email: "SAME@example.com",
            usedPercent: 25,
          }),
          provider({
            instanceId: "claude",
            driver: "claudeAgent",
            displayName: "Work",
            usedPercent: 50,
          }),
        ],
        "connected",
        [source],
      ),
    ],
  ]);

  await render();

  const text = renderedText();
  expect(text).toContain("Codex");
  expect(text).toContain("Claude");
  expect(text).toContain("Personal");
  expect(text).toContain("pool@example.com");
  expect(text.match(/same@example.com/gi)).toHaveLength(1);
  expect(text).toContain("One account could not be read.");
});

it("refreshes connected environments on open and skips disconnected ones", async () => {
  state.presentations = new Map([
    [EnvironmentId.make("connected"), presentation("Connected", [])],
    [
      EnvironmentId.make("offline"),
      presentation(
        "Offline",
        [
          provider({
            instanceId: "offline-provider",
            displayName: "Offline account",
            usedPercent: 20,
          }),
        ],
        "disconnected",
      ),
    ],
  ]);
  await render();

  expect(renderedText()).not.toContain("Offline account");
  await act(async () => state.openPopover());

  expect(state.popoverOpen).toBe(true);
  expect(state.refreshUsageLimits).toHaveBeenCalledTimes(1);
  expect(state.refreshUsageLimits).toHaveBeenCalledWith("connected", expect.any(Function), true);
  expect(state.refreshProviders).toHaveBeenCalledWith({
    environmentId: "connected",
    input: {},
  });
});

it("keeps reset confirmation mounted after closing the popover and sends the account target", async () => {
  state.presentations = new Map([
    [
      EnvironmentId.make("reset-host"),
      presentation("Reset host", [
        provider({
          instanceId: "codex-reset",
          displayName: "Resettable",
          usedPercent: 90,
          resetCredits: { availableCount: 2 },
        }),
      ]),
    ],
  ]);
  await render();
  await act(async () => state.openPopover());

  await act(() => {
    renderer.root.findByProps({ children: "Use reset" }).props.onClick();
  });
  expect(state.popoverOpen).toBe(false);
  const confirm = renderer.root.findByProps({ children: "Confirm reset" });

  await act(async () => confirm.props.onClick());

  expect(state.consumeResetCredit).toHaveBeenCalledWith({
    environmentId: "reset-host",
    input: { instanceId: "codex-reset" },
  });
  expect(state.toast).toHaveBeenCalledWith({
    type: "success",
    title: "Reset applied. Your windows have cleared.",
    description: "Resettable",
  });
});

it("reports reset warnings", async () => {
  state.consumeResetCredit.mockResolvedValueOnce({
    _tag: "Success",
    value: { outcome: "reset", warning: "Reset worked, but the routing cooldown remains." },
  });
  state.presentations = new Map([
    [
      EnvironmentId.make("warning-host"),
      presentation("Warning host", [
        provider({
          instanceId: "warning-provider",
          displayName: "Warning account",
          usedPercent: 90,
          resetCredits: { availableCount: 1 },
        }),
      ]),
    ],
  ]);
  await render();
  await act(() => renderer.root.findByProps({ children: "Use reset" }).props.onClick());
  await act(async () => renderer.root.findByProps({ children: "Confirm reset" }).props.onClick());

  expect(state.toast).toHaveBeenCalledWith({
    type: "warning",
    title: "Reset worked, but the routing cooldown remains.",
    description: "Warning account",
  });
});

it("reports reset failures", async () => {
  state.consumeResetCredit.mockResolvedValueOnce({
    _tag: "Failure",
    cause: Cause.fail(new Error("Credit expired")),
  } as never);
  state.presentations = new Map([
    [
      EnvironmentId.make("failure-host"),
      presentation("Failure host", [
        provider({
          instanceId: "failure-provider",
          displayName: "Failure account",
          usedPercent: 90,
          resetCredits: { availableCount: 1 },
        }),
      ]),
    ],
  ]);
  await render();
  await act(() => renderer.root.findByProps({ children: "Use reset" }).props.onClick());
  await act(async () => renderer.root.findByProps({ children: "Confirm reset" }).props.onClick());

  expect(state.toast).toHaveBeenCalledWith({
    type: "error",
    title: "Could not use reset credit",
    description: "Credit expired",
  });
});

it("explains the empty state", async () => {
  state.presentations = new Map([[EnvironmentId.make("empty"), presentation("Empty", [])]]);
  await render();
  expect(renderedText()).toContain("No connected provider reports subscription limits.");
});
