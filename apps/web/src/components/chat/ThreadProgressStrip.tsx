import type { OrchestrationV2PlanStep, ScopedThreadRef } from "@t3tools/contracts";
import { ChevronDownIcon, ChevronUpIcon, PanelRightIcon } from "lucide-react";
import { msg, useGT, useMessages } from "gt-react";
import { useState } from "react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";

import { cn } from "~/lib/utils";
import type { MessageResolver } from "~/i18n/messages";
import { summarizeTodoSteps, type TodoRunState } from "@t3tools/client-runtime/state/todo-progress";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerBannerStack, type ComposerBannerStackItem } from "./ComposerBannerStack";
import { useChatCanvas } from "./ChatCanvasContext";
import { ProgressRing } from "./ProgressRing";
import { RING_TONE, TodoStepList, WAITING_NOTE } from "./ThreadProgressCard";
import { showThreadProgressInDetails, useThreadProgressCardVisible } from "./threadProgressState";

function describeProgress(
  steps: ReadonlyArray<OrchestrationV2PlanStep>,
  state: TodoRunState,
  resolve: MessageResolver,
) {
  if (state === "input" || state === "approval") return resolve(WAITING_NOTE[state]);
  const { completed, total, current, position } = summarizeTodoSteps(steps);
  if (state === "done") return resolve(msg("All steps done"));
  if (state === "stopped") {
    return resolve(msg("Stopped after {completed} of {total} steps", { completed, total }));
  }
  return current
    ? resolve(msg("Step {position} of {total}: {current}", { position, total, current }))
    : resolve(msg("{completed} of {total} steps done", { completed, total }));
}

/** The agent's progress above the composer while the details card isn't showing it. */
export function ThreadProgressStrip({
  threadRef,
  steps,
  state,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly steps: ReadonlyArray<OrchestrationV2PlanStep> | null;
  readonly state: TodoRunState;
}) {
  const gt = useGT();
  const m = useMessages();
  const cardVisible = useThreadProgressCardVisible(threadRef);
  const inline = useChatCanvas()?.detailsCardPlacement != null;
  const [expanded, setExpanded] = useState(false);
  if (steps === null) return null;
  // The composer stays mounted while the card and strip trade places, so one region serves both.
  // Screen readers speak only when its text changes; the key keeps a thread switch silent.
  const announcement = (
    <span key={scopedThreadKey(threadRef)} role="status" className="sr-only">
      {describeProgress(steps, state, m)}
    </span>
  );
  if (cardVisible) return <>{announcement}</>;
  const { completed, total, current } = summarizeTodoSteps(steps);
  // While a question or approval is open, its own panel owns the composer; the strip stays one line.
  const blocked = state === "input" || state === "approval" ? state : null;
  const showList = expanded && blocked === null;
  const item: ComposerBannerStackItem = {
    id: "thread-progress",
    variant: "info",
    icon: <ProgressRing fraction={completed / total} className={cn("size-4", RING_TONE[state])} />,
    title: current ?? gt("All steps done"),
    description: blocked
      ? `${completed}/${total} · ${m(WAITING_NOTE[blocked])}`
      : `${completed}/${total}`,
    actions: (
      <>
        {blocked === null ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label={expanded ? gt("Hide steps") : gt("Show steps")}
                  aria-expanded={expanded}
                  onClick={() => setExpanded((open) => !open)}
                />
              }
            >
              {expanded ? <ChevronDownIcon /> : <ChevronUpIcon />}
            </TooltipTrigger>
            <TooltipPopup side="top">{expanded ? gt("Hide steps") : gt("Show steps")}</TooltipPopup>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label={gt("Show progress in details")}
                onClick={() => showThreadProgressInDetails(threadRef, inline)}
              />
            }
          >
            <PanelRightIcon />
          </TooltipTrigger>
          <TooltipPopup side="top">{gt("Show progress in details")}</TooltipPopup>
        </Tooltip>
      </>
    ),
    ...(showList ? { children: <TodoStepList steps={steps} state={state} /> } : {}),
  };
  return (
    <>
      {announcement}
      <ComposerBannerStack items={[item]} />
    </>
  );
}
