import {
  composerBashStatusLabel,
  parseComposerBashOutput,
  type ComposerBashCommand,
} from "@t3tools/client-runtime/composer-bash";
import { CheckIcon, ChevronDownIcon, TerminalIcon, XIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Spinner } from "../ui/spinner";
import { useId, useState, type ReactNode } from "react";

export function BashMessageDisclosure({
  command,
  children,
}: {
  command: ComposerBashCommand | undefined;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const outputId = useId();
  if (!command) return children;

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={outputId}
        onClick={() => setExpanded((value) => !value)}
        className="mb-2 flex min-h-7 w-full items-center gap-2 rounded-sm text-left text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive">
          <TerminalIcon className="size-3 shrink-0" aria-hidden="true" />
          Bash
        </span>
        <span
          className={cn(
            "flex flex-1 items-center gap-1",
            command.status === "completed" && "text-success",
            command.status === "failed" && "text-destructive",
          )}
          role="status"
          aria-label={composerBashStatusLabel(command)}
        >
          {/* Keyed so each status change replays the one-shot pop-in. */}
          <span
            key={command.status}
            className="inline-flex transition-[opacity,scale] duration-200 ease-drawer starting:scale-50 starting:opacity-0"
          >
            {command.status === "running" ? (
              <Spinner className="size-3" aria-hidden />
            ) : command.status === "completed" ? (
              <CheckIcon className="size-3" aria-hidden="true" />
            ) : (
              <XIcon className="size-3" aria-hidden="true" />
            )}
          </span>
          {command.status === "running"
            ? "Running"
            : command.status === "completed"
              ? "Completed"
              : "Failed"}
        </span>
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 transition-transform duration-200 ease-drawer",
            expanded && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>
      {children}
      {/* Grid rows animate height without measuring; inert keeps the collapsed output out of focus and AT. */}
      <div
        id={outputId}
        inert={!expanded}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-250 ease-drawer motion-reduce:transition-none",
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <BashOutput command={command} />
        </div>
      </div>
    </div>
  );
}

function BashOutput({ command }: { command: ComposerBashCommand }) {
  if (!command.output) {
    return (
      <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
        {command.status === "running" ? "Running command…" : "No command output."}
      </p>
    );
  }
  const { exitCode, stdout, stderr } = parseComposerBashOutput(command.output);
  return (
    <div className="mt-3 border-t border-border pt-3">
      <pre
        tabIndex={0}
        aria-label="Bash command result"
        className="max-h-80 overflow-auto rounded-lg bg-background/60 p-2.5 font-mono text-xs whitespace-pre-wrap break-words focus-visible:outline-2 focus-visible:outline-ring"
      >
        {stdout}
        {stdout && stderr ? "\n" : null}
        {stderr && <span className="text-destructive">{stderr}</span>}
        {!stdout && !stderr && <span className="text-muted-foreground">No output</span>}
      </pre>
      {exitCode !== null && (
        <p className="mt-1.5 text-right font-mono text-2xs text-muted-foreground">
          exit {exitCode}
        </p>
      )}
    </div>
  );
}
