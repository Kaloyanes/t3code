import { EnvironmentId, ThreadId, type UsageResumeSnapshot } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const io = vi.hoisted(() => ({
  snapshot: null as unknown,
  connected: true,
  schedule: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => io.snapshot }));
vi.mock("../../state/environments", () => ({
  useEnvironment: () => ({ connection: { phase: io.connected ? "connected" : "disconnected" } }),
}));
vi.mock("../../state/usage-resumes", () => ({
  usageResumeEnvironment: { snapshot: () => null, schedule: "schedule", cancel: "cancel" },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (name: string) => (name === "schedule" ? io.schedule : io.cancel),
}));
vi.mock("../ui/button", () => ({ Button: "button" }));
vi.mock("../ui/textarea", () => ({ Textarea: "textarea" }));
vi.mock("../ui/alert", () => ({
  Alert: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { UsageResumeBanner } from "./UsageResumeBanner";

const environmentId = EnvironmentId.make("host-a");
const threadId = ThreadId.make("thread-a");
const snapshot: UsageResumeSnapshot = {
  threadId,
  eligibility: {
    available: true,
    resetsAt: "2026-09-30T12:00:00Z",
    reason: null,
    defaultPrompt: "Continue from where you stopped.",
  },
  schedule: null,
};
const scheduled: UsageResumeSnapshot = {
  ...snapshot,
  schedule: {
    id: "resume-a",
    threadId,
    prompt: "Finish the tests.",
    scheduledAt: "2026-09-30T12:00:00Z",
    status: "pending",
    reason: null,
    createdAt: "2026-09-30T10:00:00Z",
    updatedAt: "2026-09-30T10:00:00Z",
  },
};
let renderer: ReactTestRenderer;
const view = () => (
  <UsageResumeBanner environmentId={environmentId} threadId={threadId} timestampFormat="24-hour" />
);
const button = (text: string) =>
  renderer.root.findAllByType("button").find((node) => node.props.children === text)!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  io.snapshot = AsyncResult.success(snapshot);
  io.connected = true;
  io.schedule.mockReset();
  io.cancel.mockReset();
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

describe("UsageResumeBanner", () => {
  it("preserves the reviewed prompt when the host rejects scheduling", async () => {
    io.schedule.mockResolvedValue(
      AsyncResult.failure(Cause.fail(new Error("The provider account changed."))),
    );
    await act(async () => {
      renderer = create(view());
    });
    await act(async () => button("Resume when usage resets").props.onClick());
    await act(async () =>
      renderer.root
        .findByType("textarea")
        .props.onChange({ target: { value: "Finish the tests." } }),
    );
    await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
    expect(renderer.root.findByType("textarea").props.value).toBe("Finish the tests.");
    expect(renderer.root.findByProps({ role: "alert" }).props.children).toBe(
      "The provider account changed.",
    );
    expect(button("Schedule resume").props.disabled).toBe(false);
  });

  it("replaces an open local review with a schedule created on another client", async () => {
    await act(async () => {
      renderer = create(view());
    });
    await act(async () => button("Resume when usage resets").props.onClick());
    io.snapshot = AsyncResult.success(scheduled);
    await act(async () => renderer.update(view()));
    expect(renderer.root.findAllByType("form")).toHaveLength(0);
    expect(button("Cancel resume").props.disabled).toBe(false);
    expect(io.schedule).not.toHaveBeenCalled();
  });

  it("keeps the pending schedule visible but prevents cancellation while disconnected", async () => {
    io.snapshot = AsyncResult.success(scheduled);
    await act(async () => {
      renderer = create(view());
    });
    io.connected = false;
    await act(async () => renderer.update(view()));
    expect(button("Cancel resume").props.disabled).toBe(true);
    await act(async () => button("Cancel resume").props.onClick());
    expect(io.cancel).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain("Reconnect to the host");
  });
});
