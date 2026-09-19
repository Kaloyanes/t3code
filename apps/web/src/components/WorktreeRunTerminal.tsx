import { worktreeRunEnvironment } from "../state/worktreeRun";
import { useEnvironmentQuery } from "../state/query";
import { GhosttyTerminalSurface } from "../terminal/ghostty/surface";
import { terminalThemeFromApp } from "./ThreadTerminalDrawer";
import { Button } from "./ui/button";
import type { WorktreeRunSummary } from "@t3tools/contracts";
import { Square, Trash2 } from "lucide-react";
import { useEffect, useEffectEvent, useRef } from "react";
import { useAtomCommand } from "../state/use-atom-command";
import type { WorktreeRunTerminalTarget } from "../worktreeRunTerminalStore";

export function WorktreeRunTerminal(props: {
  readonly active: WorktreeRunTerminalTarget;
  readonly runs: ReadonlyArray<WorktreeRunSummary>;
}) {
  const active = props.active;
  const write = useAtomCommand(worktreeRunEnvironment.write, { reportFailure: false });
  const resize = useAtomCommand(worktreeRunEnvironment.resize, { reportFailure: false });
  const clear = useAtomCommand(worktreeRunEnvironment.clear, { reportFailure: false });
  const stop = useAtomCommand(worktreeRunEnvironment.stop, { reportFailure: false });
  const attach = useEnvironmentQuery(
    worktreeRunEnvironment.attach({ environmentId: active.environmentId, input: active.target }),
  );
  const mountRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<GhosttyTerminalSurface | null>(null);
  const historyRef = useRef("");
  const activeKey = JSON.stringify([
    active.environmentId,
    active.target.projectId,
    active.target.workspacePath,
    active.target.scriptId,
  ]);
  const writeInput = useEffectEvent((data: string) => {
    void write({ environmentId: active.environmentId, input: { ...active.target, data } });
  });
  const resizeTerminal = useEffectEvent((cols: number, rows: number) => {
    void resize({ environmentId: active.environmentId, input: { ...active.target, cols, rows } });
  });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
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

  const selected = props.runs.find((run) => run.target.scriptId === active.target.scriptId) ?? null;
  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
      data-terminal-owner="worktree"
    >
      <div className="flex h-9 shrink-0 items-center border-b border-border/80 px-2">
        <span className="min-w-0 flex-1 truncate px-1 text-xs text-muted-foreground">
          {selected?.name ?? "Terminal"}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Clear workspace run output"
          onClick={() => void clear({ environmentId: active.environmentId, input: active.target })}
        >
          <Trash2 className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Stop workspace run"
          disabled={selected?.status !== "running" && selected?.status !== "starting"}
          onClick={() => void stop({ environmentId: active.environmentId, input: active.target })}
        >
          <Square className="size-3.5" />
        </Button>
      </div>
      <div ref={mountRef} className="min-h-0 flex-1 bg-[var(--terminal-background)]" />
      {attach.error ? (
        <div className="border-t border-border px-3 py-1 text-xs text-destructive">
          {attach.error}
        </div>
      ) : null}
    </div>
  );
}
