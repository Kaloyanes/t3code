export interface ComposerBashCommand {
  readonly status: "running" | "completed" | "failed";
  readonly output: string | null;
}

export const composerBashStatusLabel = (command: ComposerBashCommand): string =>
  command.status === "running"
    ? "Bash · Running"
    : command.status === "completed"
      ? "Bash · Completed"
      : "Bash · Failed";

export interface ComposerBashOutput {
  readonly exitCode: string | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Splits the server's `Exit code / stdout / stderr` result; other text is kept as stdout. */
export function parseComposerBashOutput(output: string): ComposerBashOutput {
  const match = /^Exit code: (\S+)\n?/.exec(output);
  if (!match) return { exitCode: null, stdout: output, stderr: "" };
  const body = output.slice(match[0].length);
  const stderrIndex = body.startsWith("stderr:\n") ? 0 : body.indexOf("\nstderr:\n");
  const stdoutPart = stderrIndex === -1 ? body : body.slice(0, Math.max(stderrIndex, 0));
  const stderr = stderrIndex === -1 ? "" : body.slice(stderrIndex + (stderrIndex === 0 ? 8 : 9));
  const stdout = stdoutPart.startsWith("stdout:\n")
    ? stdoutPart.slice(8)
    : stdoutPart === "(no output)"
      ? ""
      : stdoutPart;
  return { exitCode: match[1]!, stdout, stderr };
}

/** Composer Bash activities render on their user message, not as separate work rows. */
export const isComposerBashEntry = (entry: { readonly toolCallId?: string }): boolean =>
  entry.toolCallId?.startsWith("composer-bash:") === true;

/** Only server activities with the composer message identity confirm Bash execution. */
export function indexComposerBashCommands(
  entries: ReadonlyArray<{
    readonly toolCallId?: string;
    readonly itemType?: string;
    readonly sourceActivityKind?: string;
    readonly toolLifecycleStatus?: string;
    readonly detail?: string;
  }>,
): ReadonlyMap<string, ComposerBashCommand> {
  const commands = new Map<string, ComposerBashCommand>();
  for (const entry of entries) {
    if (!entry.toolCallId || !isComposerBashEntry(entry) || entry.itemType !== "command_execution")
      continue;
    const status =
      entry.sourceActivityKind === "tool.completed"
        ? entry.toolLifecycleStatus === "completed"
          ? "completed"
          : "failed"
        : entry.sourceActivityKind === "tool.updated" && entry.toolLifecycleStatus === "inProgress"
          ? "running"
          : null;
    if (status)
      commands.set(entry.toolCallId.slice("composer-bash:".length), {
        status,
        output: entry.detail ?? null,
      });
  }
  return commands;
}
