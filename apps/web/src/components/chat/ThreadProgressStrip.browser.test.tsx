import { EnvironmentId, ThreadId, type OrchestrationV2PlanStep } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ComponentProps } from "react";
import { expect, it } from "vite-plus/test";

import "~/index.css";

import { render } from "../../../test/render";
import { selectThreadPanelOpen, useRightPanelStore } from "../../rightPanelStore";
import { ChatCanvasContext } from "./ChatCanvasContext";
import { ThreadProgressCard } from "./ThreadProgressCard";
import { ThreadProgressStrip } from "./ThreadProgressStrip";
import { useThreadProgressStore } from "./threadProgressState";

const steps: ReadonlyArray<OrchestrationV2PlanStep> = [
  { id: "a", text: "Read the code", status: "completed" },
  { id: "b", text: "Write the fix", status: "running" },
  { id: "c", text: "Run the tests", status: "pending" },
];

function setup() {
  const threadRef = scopeThreadRef(EnvironmentId.make("env"), ThreadId.make("progress-thread"));
  useThreadProgressStore.getState().setClosed(threadRef, false);
  useRightPanelStore.getState().setThreadPanelOpen(threadRef, "inline", false);
  useRightPanelStore.getState().setThreadPanelOpen(threadRef, "popover", false);
  return threadRef;
}

// Only `detailsCardPlacement` is read by the progress components.
const inlineCanvas = {
  detailsCardPlacement: {},
} as unknown as NonNullable<ComponentProps<typeof ChatCanvasContext.Provider>["value"]>;

it("shows the current step and expands to the full list", async () => {
  const threadRef = setup();
  await using screen = await render(
    <ThreadProgressStrip threadRef={threadRef} steps={steps} state="active" />,
    {
      router: false, // no routing involved
    },
  );

  await expect.element(screen.getByText("Write the fix")).toBeVisible();
  await expect.element(screen.getByText("1/3")).toBeVisible();
  await expect.element(screen.getByRole("status")).toHaveTextContent("Step 2 of 3: Write the fix");
  await expect.element(screen.getByText("Run the tests")).not.toBeInTheDocument();

  await screen.getByRole("button", { name: "Show steps" }).click();
  await expect.element(screen.getByText("Run the tests")).toBeVisible();
});

it("hands off between the details card and the strip", async () => {
  const threadRef = setup();
  useRightPanelStore.getState().setThreadPanelOpen(threadRef, "inline", true);
  await using screen = await render(
    <ChatCanvasContext.Provider value={inlineCanvas}>
      <ThreadProgressCard threadRef={threadRef} steps={steps} state="active" />
      <ThreadProgressStrip threadRef={threadRef} steps={steps} state="active" />
    </ChatCanvasContext.Provider>,
    { router: false }, // no routing involved
  );

  await expect.element(screen.getByRole("region", { name: "Progress" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Show steps" })).not.toBeInTheDocument();
  await expect.element(screen.getByRole("status")).toHaveTextContent("Step 2 of 3: Write the fix");

  await screen.getByRole("button", { name: "Close progress" }).click();
  await expect.element(screen.getByRole("region", { name: "Progress" })).not.toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Show steps" })).toBeVisible();

  await screen.getByRole("button", { name: "Show progress in details" }).click();
  await expect.element(screen.getByRole("region", { name: "Progress" })).toBeVisible();
  expect(
    selectThreadPanelOpen(
      useRightPanelStore.getState().threadPanelVisibilityByThreadKey,
      threadRef,
      "inline",
    ),
  ).toBe(true);
});

it("keeps the strip to one line while the agent waits on an answer", async () => {
  const threadRef = setup();
  await using screen = await render(
    <ThreadProgressStrip threadRef={threadRef} steps={steps} state="input" />,
    { router: false }, // no routing involved
  );

  await expect.element(screen.getByText("1/3 · Waiting for your answer")).toBeVisible();
  await expect.element(screen.getByRole("status")).toHaveTextContent("Waiting for your answer");
  await expect.element(screen.getByRole("button", { name: "Show steps" })).not.toBeInTheDocument();
});

it("marks the current step as stopped, not running, once the run ended early", async () => {
  const threadRef = setup();
  useRightPanelStore.getState().setThreadPanelOpen(threadRef, "inline", true);
  await using screen = await render(
    <ChatCanvasContext.Provider value={inlineCanvas}>
      <ThreadProgressCard threadRef={threadRef} steps={steps} state="stopped" />
    </ChatCanvasContext.Provider>,
    { router: false }, // no routing involved
  );

  await expect.element(screen.getByText("1/3 · Stopped")).toBeVisible();
  await expect.element(screen.getByText("1 of 3 steps done, stopped")).toBeInTheDocument();
  await expect.element(screen.getByText("Write the fix")).not.toHaveClass("font-medium");
});

it("takes over when the details card is closed", async () => {
  const threadRef = setup();
  await using screen = await render(
    <ChatCanvasContext.Provider value={inlineCanvas}>
      <ThreadProgressCard threadRef={threadRef} steps={steps} state="active" />
      <ThreadProgressStrip threadRef={threadRef} steps={steps} state="active" />
    </ChatCanvasContext.Provider>,
    { router: false }, // no routing involved
  );

  await expect.element(screen.getByRole("region", { name: "Progress" })).not.toBeInTheDocument();
  await expect.element(screen.getByText("Write the fix")).toBeVisible();
});
