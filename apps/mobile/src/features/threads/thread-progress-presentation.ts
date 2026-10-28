import type { OrchestrationV2PlanStep } from "@t3tools/contracts";
import { summarizeTodoSteps, type TodoRunState } from "@t3tools/client-runtime/state/todo-progress";

export type ThreadProgressTone = "active" | "waiting" | "done" | "muted";

const WAITING_NOTE = {
  input: "Waiting for your answer",
  approval: "Waiting for your approval",
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
) {
  const { completed, total, current } = summarizeTodoSteps(steps);
  const count = `${completed}/${total}`;
  const note = state === "input" || state === "approval" ? WAITING_NOTE[state] : null;
  return {
    fraction: completed / total,
    title: current ?? "All steps done",
    count,
    note,
    description: note === null ? count : `${count} · ${note}`,
    tone: RING_TONE[state],
    summary: `${state === "stopped" ? "Stopped · " : ""}${completed} of ${total}`,
    segments:
      total <= MAX_SEGMENTS ? steps.map((step) => ({ id: step.id, status: step.status })) : null,
  };
}

export function presentThreadProgressStep(step: OrchestrationV2PlanStep, state: TodoRunState) {
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
      note: WAITING_NOTE[state],
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
    note: "In progress",
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
  label: string,
  progress: { readonly completed: number; readonly total: number } | null | undefined,
) {
  if (!progress || (status !== "working" && status !== "input" && status !== "approval")) {
    return label;
  }
  return `${label} ${progress.completed}/${progress.total}`;
}
