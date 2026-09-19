import { useAtomValue } from "@effect/atom-react";
import {
  AutomationId,
  AutomationRunId,
  ProviderInstanceId,
  ProjectId,
  type Automation,
  type AutomationExecution,
  type AutomationRun,
  type AutomationSchedule,
  type EnvironmentId,
  type RuntimeMode,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Option from "effect/Option";
import {
  CalendarClockIcon,
  CheckCircle2Icon,
  Clock3Icon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { automationEnvironment } from "../../state/automations";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useAtomCommand } from "../../state/use-atom-command";
import { cn } from "../../lib/utils";
import { isElectron } from "../../env";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Textarea } from "../ui/textarea";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

type ScheduleKind = "once" | "daily" | "weekly";
type Weekday = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

interface AutomationFormState {
  readonly projectId: string;
  readonly name: string;
  readonly prompt: string;
  readonly kind: ScheduleKind;
  readonly date: string;
  readonly time: string;
  readonly timeZone: string;
  readonly days: ReadonlyArray<Weekday>;
  readonly modelInstance: string;
  readonly model: string;
  readonly baseBranch: string;
  readonly runtimeMode: RuntimeMode;
}

const WEEKDAYS: ReadonlyArray<{ readonly value: Weekday; readonly label: string }> = [
  { value: "monday", label: "M" },
  { value: "tuesday", label: "T" },
  { value: "wednesday", label: "W" },
  { value: "thursday", label: "T" },
  { value: "friday", label: "F" },
  { value: "saturday", label: "S" },
  { value: "sunday", label: "S" },
];

const STATUS_LABELS = {
  active: "Active",
  paused: "Paused",
  canceled: "Canceled",
} as const;

const RUN_STATUS_LABELS = {
  scheduled: "Scheduled",
  running: "Running",
  "waiting-for-input": "Waiting for input",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
  missed: "Missed",
  canceled: "Canceled",
} as const;

function defaultForm(projectId = ""): AutomationFormState {
  return {
    projectId,
    name: "",
    prompt: "Run the repository health checks and summarize failures.",
    kind: "daily",
    date: new Date().toISOString().slice(0, 10),
    time: "09:00",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    days: ["monday", "friday"],
    modelInstance: "codex",
    model: "gpt-5.6",
    baseBranch: "main",
    runtimeMode: "approval-required",
  };
}

function formFromAutomation(automation: Automation): AutomationFormState {
  const schedule = automation.schedule;
  return {
    projectId: automation.projectId,
    name: automation.name,
    prompt: automation.prompt,
    kind: schedule.kind,
    date: schedule.kind === "once" ? schedule.date : new Date().toISOString().slice(0, 10),
    time: schedule.time,
    timeZone: schedule.timeZone,
    days: schedule.kind === "weekly" ? schedule.days : ["monday", "friday"],
    modelInstance: automation.execution.modelSelection.instanceId,
    model: automation.execution.modelSelection.model,
    baseBranch: automation.execution.baseBranch,
    runtimeMode: automation.execution.runtimeMode,
  };
}

function scheduleFromForm(form: AutomationFormState): AutomationSchedule {
  if (form.kind === "once") {
    return { kind: "once", date: form.date, time: form.time, timeZone: form.timeZone };
  }
  if (form.kind === "weekly") {
    return { kind: "weekly", days: form.days, time: form.time, timeZone: form.timeZone };
  }
  return { kind: "daily", time: form.time, timeZone: form.timeZone };
}

function executionFromForm(form: AutomationFormState): AutomationExecution {
  return {
    modelSelection: {
      instanceId: ProviderInstanceId.make(form.modelInstance.trim()),
      model: form.model.trim(),
    },
    baseBranch: form.baseBranch.trim(),
    runtimeMode: form.runtimeMode,
    interactionMode: "default",
    worktreePolicy: "dedicated",
  };
}

function formatInstant(value: string | null, timeZone: string): string {
  if (value === null) return "Not scheduled";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

function formatSchedule(schedule: AutomationSchedule): string {
  if (schedule.kind === "once") return `Once · ${schedule.date} at ${schedule.time}`;
  if (schedule.kind === "daily") return `Daily at ${schedule.time}`;
  return `${schedule.days.map((day) => day.slice(0, 3)).join(", ")} at ${schedule.time}`;
}

function statusTone(status: Automation["status"]): string {
  if (status === "active") return "text-emerald-500";
  if (status === "paused") return "text-amber-500";
  return "text-muted-foreground";
}

function runTone(status: AutomationRun["status"]): string {
  if (status === "completed") return "text-emerald-500";
  if (status === "failed") return "text-destructive";
  if (status === "running" || status === "waiting-for-input") return "text-sky-500";
  return "text-muted-foreground";
}

function FormField({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

function AutomationEditor({
  form,
  projects,
  editing,
  saving,
  onChange,
  onSubmit,
  onNew,
}: {
  readonly form: AutomationFormState;
  readonly projects: ReadonlyArray<{ readonly id: ProjectId; readonly title: string }>;
  readonly editing: boolean;
  readonly saving: boolean;
  readonly onChange: (patch: Partial<AutomationFormState>) => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly onNew: () => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4 rounded-xl border border-border/70 bg-card p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {editing ? "Edit automation" : "New automation"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Future runs use the saved configuration snapshot.
          </p>
        </div>
        {editing ? (
          <Button type="button" size="xs" variant="ghost" onClick={onNew}>
            <PlusIcon /> New
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Name">
          <Input
            required
            value={form.name}
            onChange={(event) => onChange({ name: event.target.value })}
            placeholder="Daily repository health"
          />
        </FormField>
        <FormField label="Project">
          <select
            required
            disabled={editing}
            value={form.projectId}
            onChange={(event) => onChange({ projectId: event.target.value })}
            className="h-8 rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="" disabled>
              Select project
            </option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <FormField label="Prompt">
        <Textarea
          required
          value={form.prompt}
          onChange={(event) => onChange({ prompt: event.target.value })}
          placeholder="What should the agent do?"
        />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Schedule">
          <select
            value={form.kind}
            onChange={(event) => onChange({ kind: event.target.value as ScheduleKind })}
            className="h-8 rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="once">Once</option>
            <option value="daily">Every day</option>
            <option value="weekly">Weekly</option>
          </select>
        </FormField>
        <FormField label="Time zone">
          <Input
            required
            value={form.timeZone}
            onChange={(event) => onChange({ timeZone: event.target.value })}
          />
        </FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {form.kind === "once" ? (
          <FormField label="Date">
            <Input
              required
              type="date"
              value={form.date}
              onChange={(event) => onChange({ date: event.target.value })}
            />
          </FormField>
        ) : null}
        <FormField label="Time">
          <Input
            required
            type="time"
            value={form.time}
            onChange={(event) => onChange({ time: event.target.value })}
          />
        </FormField>
      </div>
      {form.kind === "weekly" ? (
        <FormField label="Days">
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((day) => {
              const selected = form.days.includes(day.value);
              return (
                <Button
                  key={day.value}
                  type="button"
                  size="icon-xs"
                  variant={selected ? "default" : "outline"}
                  aria-pressed={selected}
                  onClick={() =>
                    onChange({
                      days: selected
                        ? form.days.filter((value) => value !== day.value)
                        : [...form.days, day.value],
                    })
                  }
                >
                  {day.label}
                </Button>
              );
            })}
          </div>
        </FormField>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Provider instance">
          <Input
            required
            value={form.modelInstance}
            onChange={(event) => onChange({ modelInstance: event.target.value })}
          />
        </FormField>
        <FormField label="Model">
          <Input
            required
            value={form.model}
            onChange={(event) => onChange({ model: event.target.value })}
          />
        </FormField>
        <FormField label="Base branch">
          <Input
            required
            value={form.baseBranch}
            onChange={(event) => onChange({ baseBranch: event.target.value })}
          />
        </FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Agent safety">
          <select
            value={form.runtimeMode}
            onChange={(event) => onChange({ runtimeMode: event.target.value as RuntimeMode })}
            className="h-8 rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="approval-required">Ask before risky actions</option>
            <option value="auto-accept-edits">Auto-accept edits</option>
            <option value="auto">Auto</option>
            <option value="full-access">Full access</option>
          </select>
        </FormField>
        <div className="flex items-end text-xs text-muted-foreground">
          Every run uses a dedicated worktree.
        </div>
      </div>
      <Button type="submit" disabled={saving || form.days.length === 0}>
        {saving ? (
          <RefreshCwIcon className="animate-spin" />
        ) : editing ? (
          <CheckCircle2Icon />
        ) : (
          <PlusIcon />
        )}
        {editing ? "Save changes" : "Create automation"}
      </Button>
    </form>
  );
}

function AutomationEnvironmentPanel({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const target = { environmentId, input: {} } as const;
  const result = useAtomValue(automationEnvironment.snapshot(target));
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const snapshot = Option.getOrNull(AsyncResult.value(result));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<AutomationFormState>(() => defaultForm(projects[0]?.id));
  const [saving, setSaving] = useState(false);
  const automations = snapshot?.automations ?? [];
  const selected =
    automations.find((automation) => automation.id === selectedId) ?? automations[0] ?? null;
  const runs = useMemo(
    () =>
      selected ? (snapshot?.runs.filter((run) => run.automationId === selected.id) ?? []) : [],
    [selected, snapshot],
  );
  const selectedProject = projects.find((project) => project.id === selected?.projectId);
  const activeRun = runs.find((run) =>
    ["scheduled", "running", "waiting-for-input"].includes(run.status),
  );
  const create = useAtomCommand(automationEnvironment.create, { reportFailure: true });
  const update = useAtomCommand(automationEnvironment.update, { reportFailure: true });
  const pause = useAtomCommand(automationEnvironment.pause, { reportFailure: true });
  const resume = useAtomCommand(automationEnvironment.resume, { reportFailure: true });
  const cancel = useAtomCommand(automationEnvironment.cancel, { reportFailure: true });
  const runNow = useAtomCommand(automationEnvironment.runNow, { reportFailure: true });
  const retryRun = useAtomCommand(automationEnvironment.retryRun, { reportFailure: true });
  const stopRun = useAtomCommand(automationEnvironment.stopRun, { reportFailure: true });
  const refresh = () => appAtomRegistry.refresh(automationEnvironment.snapshot(target));
  const applyForm = (patch: Partial<AutomationFormState>) =>
    setForm((current) => ({ ...current, ...patch }));

  useEffect(() => {
    if (selected === null) {
      setSelectedId(null);
      return;
    }
    setSelectedId((current) => current ?? selected.id);
  }, [selected]);

  useEffect(() => {
    if (editing && selected) setForm(formFromAutomation(selected));
    if (!editing) setForm(defaultForm(projects[0]?.id));
  }, [editing, selected?.id, environmentId, projects[0]?.id]);

  const startNew = () => {
    setEditing(false);
    setForm(defaultForm(projects[0]?.id));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    const input = {
      name: form.name.trim(),
      prompt: form.prompt.trim(),
      schedule: scheduleFromForm(form),
      execution: executionFromForm(form),
    };
    const result =
      editing && selected
        ? await update({
            environmentId,
            input: { id: AutomationId.make(selected.id), ...input },
          })
        : await create({
            environmentId,
            input: { projectId: ProjectId.make(form.projectId), ...input },
          });
    setSaving(false);
    if (AsyncResult.isSuccess(result)) {
      setEditing(false);
      await refresh();
    }
  };

  const runAction = async (action: () => Promise<unknown>) => {
    await action();
    await refresh();
  };

  if (Option.isNone(AsyncResult.value(result))) {
    return (
      <div className="rounded-xl border border-border/70 bg-card p-6 text-sm text-muted-foreground">
        Loading automations…
      </div>
    );
  }

  return (
    <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <aside className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <div>
            <p className="text-sm font-semibold">Automations</p>
            <p className="text-xs text-muted-foreground">{automations.length} configured</p>
          </div>
          <Button size="icon-sm" variant="outline" aria-label="New automation" onClick={startNew}>
            <PlusIcon />
          </Button>
        </div>
        {automations.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            No automations yet. Create one to make a useful recurring task hands-off.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {automations.map((automation) => (
              <button
                key={automation.id}
                type="button"
                onClick={() => {
                  setSelectedId(automation.id);
                  setEditing(true);
                }}
                className={cn(
                  "flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-accent/60",
                  selected?.id === automation.id
                    ? "border-ring bg-accent/60"
                    : "border-transparent",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <span
                    className={cn(
                      "size-1.5 rounded-full bg-current",
                      statusTone(automation.status),
                    )}
                  />
                  {automation.name}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {formatSchedule(automation.schedule)}
                </span>
              </button>
            ))}
          </div>
        )}
      </aside>
      <section className="flex min-w-0 flex-col gap-5">
        {selected ? (
          <>
            <div className="rounded-xl border border-border/70 bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-lg font-semibold">{selected.name}</h2>
                    <span className={cn("text-xs font-medium", statusTone(selected.status))}>
                      {STATUS_LABELS[selected.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedProject?.title ?? "Unknown project"} ·{" "}
                    {formatSchedule(selected.schedule)}
                  </p>
                  <p className="mt-3 max-w-2xl whitespace-pre-wrap text-sm text-foreground/80">
                    {selected.prompt}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selected.status === "active" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void runAction(() =>
                          pause({ environmentId, input: { id: AutomationId.make(selected.id) } }),
                        )
                      }
                    >
                      <PauseIcon /> Pause
                    </Button>
                  ) : selected.status === "paused" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void runAction(() =>
                          resume({ environmentId, input: { id: AutomationId.make(selected.id) } }),
                        )
                      }
                    >
                      <PlayIcon /> Resume
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={activeRun !== undefined || selected.status === "canceled"}
                    onClick={() =>
                      void runAction(() =>
                        runNow({ environmentId, input: { id: AutomationId.make(selected.id) } }),
                      )
                    }
                  >
                    <PlayIcon /> Run now
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                  {selected.status !== "canceled" ? (
                    <Button
                      size="sm"
                      variant="destructive-outline"
                      onClick={() =>
                        window.confirm("Cancel this automation and its queued schedule?") &&
                        void runAction(() =>
                          cancel({ environmentId, input: { id: AutomationId.make(selected.id) } }),
                        )
                      }
                    >
                      <Trash2Icon /> Cancel
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="mt-5 grid gap-3 border-t border-border/60 pt-4 text-xs sm:grid-cols-3">
                <div>
                  <span className="text-muted-foreground">Next run</span>
                  <p className="mt-1 font-medium text-foreground">
                    {formatInstant(selected.nextRunAt, selected.schedule.timeZone)}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Execution</span>
                  <p className="mt-1 font-medium text-foreground">
                    {selected.execution.modelSelection.instanceId} ·{" "}
                    {selected.execution.modelSelection.model}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Safety</span>
                  <p className="mt-1 font-medium text-foreground">
                    {selected.execution.runtimeMode} · dedicated worktree
                  </p>
                </div>
              </div>
            </div>
            {activeRun ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-500/25 bg-sky-500/5 px-4 py-3 text-sm">
                <span className="flex items-center gap-2">
                  <Clock3Icon className="size-4 text-sky-500" />{" "}
                  {RUN_STATUS_LABELS[activeRun.status]}{" "}
                  {activeRun.lateByMs > 0
                    ? `· ${Math.round(activeRun.lateByMs / 60_000)}m late`
                    : ""}
                </span>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    window.confirm("Stop the active run?") &&
                    void runAction(() =>
                      stopRun({ environmentId, input: { id: AutomationRunId.make(activeRun.id) } }),
                    )
                  }
                >
                  <SquareIcon /> Stop run
                </Button>
              </div>
            ) : null}
            <div className="rounded-xl border border-border/70 bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Run history</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Each run is isolated and keeps its original prompt and execution settings.
                  </p>
                </div>
                <CalendarClockIcon className="size-4 text-muted-foreground" />
              </div>
              <div className="mt-4 divide-y divide-border/60">
                {runs.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">No runs yet.</p>
                ) : (
                  runs.map((run) => (
                    <div
                      key={run.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-medium">
                          <span
                            className={cn("size-1.5 rounded-full bg-current", runTone(run.status))}
                          />
                          {RUN_STATUS_LABELS[run.status]}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatInstant(run.scheduledAt, selected.schedule.timeZone)}
                          {run.reason ? ` · ${run.reason}` : ""}
                        </p>
                      </div>
                      {run.status === "failed" ? (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() =>
                            void runAction(() =>
                              retryRun({
                                environmentId,
                                input: { id: AutomationRunId.make(run.id) },
                              }),
                            )
                          }
                        >
                          <RotateCcwIcon /> Retry
                        </Button>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Create an automation to schedule a useful agent task.
          </div>
        )}
        {(!editing && selected !== null) || selected === null ? null : null}
        {editing || selected === null ? (
          <AutomationEditor
            form={form}
            projects={projects}
            editing={selected !== null && editing}
            saving={saving}
            onChange={applyForm}
            onSubmit={submit}
            onNew={startNew}
          />
        ) : null}
      </section>
    </div>
  );
}

export function AutomationsPage() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(
    primaryEnvironmentId ?? environments[0]?.environmentId ?? null,
  );
  useEffect(() => {
    if (
      environmentId === null ||
      !environments.some((environment) => environment.environmentId === environmentId)
    ) {
      setEnvironmentId(primaryEnvironmentId ?? environments[0]?.environmentId ?? null);
    }
  }, [environmentId, environments, primaryEnvironmentId]);
  const environment = environments.find((candidate) => candidate.environmentId === environmentId);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron} className="h-auto">
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-sm font-semibold">Automations</h1>
              <p className="text-xs text-muted-foreground">
                Schedule useful agent work and keep every run under your control.
              </p>
            </div>
            {environments.length > 1 ? (
              <select
                value={environmentId ?? ""}
                onChange={(event) => setEnvironmentId(event.target.value as EnvironmentId)}
                className="h-8 max-w-64 rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {environments.map((candidate) => (
                  <option key={candidate.environmentId} value={candidate.environmentId}>
                    {candidate.label}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </WorkspacePageHeader>
        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="expanded">
            {environmentId === null || environment === undefined ? (
              <p className="text-sm text-muted-foreground">
                Connect an environment to schedule agent work.
              </p>
            ) : environment.serverConfig?.environment.capabilities.scheduledAutomations !== true ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                This environment server does not support scheduled automations yet. Update T3 Code
                on that machine and reconnect.
              </div>
            ) : (
              <AutomationEnvironmentPanel environmentId={environmentId} />
            )}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}
