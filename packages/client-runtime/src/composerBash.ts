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
    if (!entry.toolCallId?.startsWith("composer-bash:") || entry.itemType !== "command_execution")
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
