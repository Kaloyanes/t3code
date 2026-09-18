import { useAtomCommand } from "../state/use-atom-command";
import { useEnvironmentQuery } from "../state/query";
import { worktreeRunEnvironment } from "../state/worktreeRun";
import { useWorktreeRunConsoleStore } from "../worktreeRunConsoleStore";
import { GhosttyTerminalSurface } from "../terminal/ghostty/surface";
import { terminalThemeFromApp } from "./ThreadTerminalDrawer";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { Square, Trash2, X } from "lucide-react";
import { useEffect, useEffectEvent, useMemo, useRef } from "react";

export function WorktreeRunConsole() {
  const active = useWorktreeRunConsoleStore((state) => state.active);
  const close = useWorktreeRunConsoleStore((state) => state.close);
  const select = useWorktreeRunConsoleStore((state) => state.select);
  const write = useAtomCommand(worktreeRunEnvironment.write, { reportFailure: false });
  const resize = useAtomCommand(worktreeRunEnvironment.resize, { reportFailure: false });
  const clear = useAtomCommand(worktreeRunEnvironment.clear, { reportFailure: false });
  const stop = useAtomCommand(worktreeRunEnvironment.stop, { reportFailure: false });
  const metadata = useEnvironmentQuery(
    active
      ? worktreeRunEnvironment.metadata({ environmentId: active.environmentId, input: null })
      : null,
  );
  const attach = useEnvironmentQuery(
    active
      ? worktreeRunEnvironment.attach({
          environmentId: active.environmentId,
          input: active.target,
        })
      : null,
  );
  const runs = useMemo(
    () =>
      (metadata.data ?? []).filter(
        (run) =>
          active !== null &&
          run.target.projectId === active.target.projectId &&
          run.target.workspacePath === active.target.workspacePath,
      ),
    [active, metadata.data],
  );
  const mountRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<GhosttyTerminalSurface | null>(null);
  const historyRef = useRef("");
  const activeKey = active
    ? JSON.stringify([
        active.environmentId,
        active.target.projectId,
        active.target.workspacePath,
        active.target.scriptId,
      ])
    : null;
  const writeInput = useEffectEvent((data: string) => {
    if (active)
      void write({ environmentId: active.environmentId, input: { ...active.target, data } });
  });
  const resizeTerminal = useEffectEvent((cols: number, rows: number) => {
    if (active)
      void resize({
        environmentId: active.environmentId,
        input: { ...active.target, cols, rows },
      });
  });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || activeKey === null) return;
    let disposed = false;
    void GhosttyTerminalSurface.create(mount, {
      theme: terminalThemeFromApp(mount),
      visible: true,
      onData: writeInput,
      onResize: resizeTerminal,
      onSelectionChange: () => undefined,
      beforeKey: () => true,
      onLinkActivate: () => undefined,
    }).then((terminal) => {
      if (disposed) return terminal.dispose();
      terminalRef.current = terminal;
      historyRef.current = "";
      terminal.focus();
    });
    return () => {
      disposed = true;
      terminalRef.current?.dispose();
      terminalRef.current = null;
      historyRef.current = "";
    };
  }, [activeKey]);

  useEffect(() => {
    const next = attach.data?.history ?? "";
    const previous = historyRef.current;
    const terminal = terminalRef.current;
    if (!terminal || next === previous) return;
    if (next.startsWith(previous)) terminal.write(next.slice(previous.length));
    else terminal.resetAndWrite(next);
    historyRef.current = next;
  }, [attach.data?.history]);

  if (!active) return null;
  const selected = runs.find((run) => run.target.scriptId === active.target.scriptId) ?? null;
  return (
    <section className="fixed inset-x-0 bottom-0 z-40 ml-[var(--sidebar-width)] flex h-80 min-h-48 flex-col border-t border-border bg-background shadow-[0_-8px_30px_rgba(0,0,0,0.12)]">
      <div className="flex h-10 shrink-0 items-center border-b border-border px-2">
        <div className="flex min-w-0 flex-1 items-end gap-1 self-stretch overflow-x-auto">
          {runs.map((run) => (
            <button
              key={run.target.scriptId}
              type="button"
              onClick={() => select(run.target.scriptId)}
              className={cn(
                "flex h-full shrink-0 items-center gap-2 border-b-2 px-3 text-xs",
                run.target.scriptId === active.target.scriptId
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  run.status === "running" || run.status === "starting"
                    ? "bg-emerald-500"
                    : "bg-muted-foreground/50",
                )}
              />
              {run.name}
            </button>
          ))}
        </div>
        <span className="mr-2 max-w-64 truncate text-xs text-muted-foreground">
          {active.target.workspacePath}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Clear worktree action output"
          onClick={() => void clear({ environmentId: active.environmentId, input: active.target })}
        >
          <Trash2 className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Stop worktree action"
          disabled={selected?.status !== "running" && selected?.status !== "starting"}
          onClick={() => void stop({ environmentId: active.environmentId, input: active.target })}
        >
          <Square className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close worktree action panel"
          onClick={close}
        >
          <X className="size-4" />
        </Button>
      </div>
      <div ref={mountRef} className="min-h-0 flex-1 bg-background" />
      {attach.error ? (
        <div className="border-t border-border px-3 py-1 text-xs text-destructive">
          {attach.error}
        </div>
      ) : null}
    </section>
  );
}
