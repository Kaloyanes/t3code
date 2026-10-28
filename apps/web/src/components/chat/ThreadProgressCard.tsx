import type { OrchestrationV2PlanStep, ScopedThreadRef } from "@t3tools/contracts";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  MessageCircleQuestionMarkIcon,
  ShieldQuestionIcon,
  XIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { summarizeTodoSteps, type TodoRunState } from "@t3tools/client-runtime/state/todo-progress";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { ProgressRing } from "./ProgressRing";
import { useThreadProgressCardVisible, useThreadProgressStore } from "./threadProgressState";

const STEP_ICONS = {
  completed: CircleCheckIcon,
  running: CircleDotIcon,
  pending: CircleDashedIcon,
} as const;

export const RING_TONE = {
  active: "text-info-foreground",
  input: "text-warning-foreground",
  approval: "text-warning-foreground",
  done: "text-success-foreground",
  stopped: "text-muted-foreground",
} as const satisfies Record<TodoRunState, string>;

// The viewport keeps the current step in sight once a long plan scrolls.
function keepInView(node: HTMLLIElement | null) {
  node?.scrollIntoView({ block: "nearest" });
}

export const WAITING_NOTE = {
  input: "Waiting for your answer",
  approval: "Waiting for your approval",
} as const;

const BLOCKED_ICONS = {
  input: MessageCircleQuestionMarkIcon,
  approval: ShieldQuestionIcon,
} as const;

export function TodoStepList({
  steps,
  state = "active",
}: {
  readonly steps: ReadonlyArray<OrchestrationV2PlanStep>;
  readonly state?: TodoRunState;
}) {
  return (
    <ol className="flex flex-col">
      {steps.map((step) => {
        const isCurrent = step.status === "running";
        const blocked = isCurrent && (state === "input" || state === "approval") ? state : null;
        const stalled = isCurrent && state === "stopped";
        const Icon = blocked
          ? BLOCKED_ICONS[blocked]
          : stalled
            ? CircleDashedIcon
            : STEP_ICONS[step.status];
        return (
          <li
            key={step.id}
            ref={isCurrent ? keepInView : undefined}
            aria-current={isCurrent ? "step" : undefined}
            className="flex items-start gap-2.5 px-1 py-1 text-sm"
          >
            <Icon
              aria-hidden
              className={cn(
                "mt-0.5 size-4 shrink-0",
                step.status === "completed" && "text-success-foreground",
                isCurrent && "text-info-foreground",
                blocked && "text-warning-foreground",
                stalled && "text-muted-foreground",
                step.status === "pending" && "text-muted-foreground/70",
              )}
            />
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  step.status === "completed" &&
                    "text-muted-foreground line-through decoration-muted-foreground/40",
                  isCurrent && !stalled && "font-medium",
                  (step.status === "pending" || stalled) && "text-muted-foreground",
                )}
              >
                {step.text}
              </span>
              {blocked ? (
                <span className="block text-xs text-muted-foreground">{WAITING_NOTE[blocked]}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Renders under the details card while the agent's task list is on screen there. */
export function ThreadProgressCard({
  threadRef,
  steps,
  state,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly steps: ReadonlyArray<OrchestrationV2PlanStep> | null;
  readonly state: TodoRunState;
}) {
  const visible = useThreadProgressCardVisible(threadRef);
  if (steps === null || !visible) return null;
  const { completed, total } = summarizeTodoSteps(steps);
  return (
    <section
      aria-label="Progress"
      data-thread-progress-card
      className="dropdown-glass isolate contain-paint flex max-h-72 min-h-0 shrink-0 flex-col overflow-hidden rounded-2xl"
    >
      <div className="flex min-h-10 items-center gap-2.5 pt-1.5 pr-2 pl-4.5">
        <ProgressRing
          fraction={completed / total}
          className={cn("size-4 shrink-0", RING_TONE[state])}
        />
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">Progress</h3>
        <span className="text-xs text-muted-foreground tabular-nums" aria-hidden>
          {completed}/{total}
          {state === "stopped" ? " · Stopped" : ""}
        </span>
        <span className="sr-only">
          {completed} of {total} steps done{state === "stopped" ? ", stopped" : ""}
        </span>
        <span className="flex size-8 shrink-0 items-center justify-center">
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="Close progress"
            onClick={() => useThreadProgressStore.getState().setClosed(threadRef, true)}
          >
            <XIcon />
          </Button>
        </span>
      </div>
      <ScrollArea scrollFade className="min-h-0">
        <div className="px-3.5 pt-1 pb-2.5">
          <TodoStepList steps={steps} state={state} />
        </div>
      </ScrollArea>
    </section>
  );
}
