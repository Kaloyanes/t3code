import type { OrchestrationV2PlanStep } from "@t3tools/contracts";
import { summarizeTodoSteps, type TodoRunState } from "@t3tools/client-runtime/state/todo-progress";
import { msg } from "gt-react-native";

import { m, type MessageResolver } from "../../i18n/messages";

export type ThreadProgressTone = "active" | "waiting" | "done" | "muted";

const WAITING_NOTE = {
  input: msg("Waiting for your answer"),
  approval: msg("Waiting for your approval"),
} as const;

const RING_TONE = {
  active: "active",
  input: "waiting",
  approval: "waiting",
  done: "done",
  stopped: "muted",
} as const satisfies Record<TodoRunState, ThreadProgressTone>;

const MAX_SEGMENTS = 12;

export function presentThreadProgress(
  steps: ReadonlyArray<OrchestrationV2PlanStep>,
  state: TodoRunState,
  resolve: MessageResolver = m,
) {
  const { completed, total, current } = summarizeTodoSteps(steps);
  const count = `${completed}/${total}`;
  const note = state === "input" || state === "approval" ? resolve(WAITING_NOTE[state]) : null;
  return {
    fraction: completed / total,
    title: current ?? resolve(msg("All steps done")),
    count,
    note,
    description: note === null ? count : `${count} · ${note}`,
    tone: RING_TONE[state],
    summary:
      state === "stopped"
        ? resolve(msg("Stopped · {completed} of {total}", { completed, total }))
        : resolve(msg("{completed} of {total}", { completed, total, $context: "task steps done" })),
    segments:
      total <= MAX_SEGMENTS ? steps.map((step) => ({ id: step.id, status: step.status })) : null,
  };
}

export function presentThreadProgressStep(
  step: OrchestrationV2PlanStep,
  state: TodoRunState,
  resolve: MessageResolver = m,
) {
  if (step.status === "completed") {
    return {
      icon: "checkmark.circle.fill",
      tone: "done",
      note: null,
      strike: true,
      highlight: false,
    } as const;
  }
  if (step.status === "pending") {
    return {
      icon: "circle.dashed",
      tone: "muted",
      note: null,
      strike: false,
      highlight: false,
    } as const;
  }
  if (state === "input" || state === "approval") {
    return {
      icon: state === "input" ? "questionmark.bubble" : "exclamationmark.shield",
      tone: "waiting",
      note: resolve(WAITING_NOTE[state]),
      strike: false,
      highlight: true,
    } as const;
  }
  if (state === "stopped") {
    return {
      icon: "circle.dashed",
      tone: "muted",
      note: null,
      strike: false,
      highlight: false,
    } as const;
  }
  return {
    icon: "circle.inset.filled",
    tone: "active",
    note: resolve(msg("In progress", { $context: "task step status" })),
    strike: false,
    highlight: true,
  } as const;
}

export const THREAD_PROGRESS_TONE_CLASSES = {
  active: {
    text: "text-adaptive-sky-600-400",
    accent: "accent-adaptive-sky-600-400",
  },
  waiting: { text: "text-warning-foreground", accent: "accent-warning-foreground" },
  done: {
    text: "text-adaptive-emerald-700-300",
    accent: "accent-adaptive-emerald-700-300",
  },
  muted: { text: "text-foreground-muted", accent: "accent-foreground-muted" },
} as const satisfies Record<ThreadProgressTone, { text: string; accent: string }>;

/** The thread list keeps the step count on a row that is working or blocked on the user. */
export function withProgressCount(
  status: string,
  label: string | null,
  progress: { readonly completed: number; readonly total: number } | null | undefined,
) {
  if (!progress || (status !== "working" && status !== "input" && status !== "approval")) {
    return label;
  }
  const count = `${progress.completed}/${progress.total}`;
  return label === null ? count : `${label} ${count}`;
}
