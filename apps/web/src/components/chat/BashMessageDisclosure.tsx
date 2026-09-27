import {
  composerBashStatusLabel,
  type ComposerBashCommand,
} from "@t3tools/client-runtime/composer-bash";
import { ChevronDownIcon, TerminalIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

export function BashMessageDisclosure({
  command,
  children,
}: {
  command: ComposerBashCommand | undefined;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
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
        <TerminalIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="flex-1" role="status">
          {composerBashStatusLabel(command)}
        </span>
        <ChevronDownIcon
          className={`size-3.5 shrink-0 ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {children}
      <div id={outputId} hidden={!expanded}>
        {expanded && (
          <pre
            tabIndex={0}
            aria-label="Bash command result"
            className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-border pt-3 font-mono text-xs focus-visible:outline-2 focus-visible:outline-ring"
          >
            {command.output ||
              (command.status === "running" ? "Running command…" : "No command output.")}
          </pre>
        )}
      </div>
    </div>
  );
}
