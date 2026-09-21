import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  type ChatAttachment,
  type OrchestrationMessage,
} from "@t3tools/contracts";
import { serializeLegacyContextMessage } from "@t3tools/shared/composerContextLegacySend";

type HandoffMessage = Pick<OrchestrationMessage, "role" | "text" | "attachments" | "context">;

interface ThreadHandoffInput {
  source: {
    title: string;
    threadId: string;
    branch?: string | null;
    worktreePath?: string | null;
  };
  messages: ReadonlyArray<HandoffMessage>;
  hasOlderHistory: boolean;
  maxTextChars?: number;
}

interface ThreadHandoffPackage {
  text: string;
  attachments: ReadonlyArray<ChatAttachment>;
}

const DEFAULT_MAX_TEXT_CHARS = PROVIDER_SEND_TURN_MAX_INPUT_CHARS - 4_000;

function messageText(message: HandoffMessage): string {
  return message.context
    ? serializeLegacyContextMessage({ text: message.text, records: message.context.records })
    : message.text;
}

function messageBlock(message: HandoffMessage): string {
  const attachments = message.attachments?.filter(
    (attachment) => attachment.type === "image" || attachment.type === "file",
  );
  const attachmentLine = attachments?.length
    ? `\n\nAttachments: ${attachments.map(({ name }) => name).join(", ")}`
    : "";
  return `### ${message.role === "user" ? "User" : "Agent"}\n${messageText(message)}${attachmentLine}`;
}

function truncateBlock(block: string, maxChars: number): string {
  if (block.length <= maxChars) return block;
  const suffix = "\n[message truncated]";
  return `${block.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}

function boundedConversation(blocks: ReadonlyArray<string>, maxChars: number): string {
  const full = blocks.join("\n\n");
  if (full.length <= maxChars) return full;

  const omission = "[Some conversation history was omitted to fit the provider input limit.]";
  if (blocks.length === 1) return truncateBlock(blocks[0]!, maxChars);

  const separatorChars = 4 + omission.length;
  const available = Math.max(0, maxChars - separatorChars);
  const firstBudget = Math.min(Math.floor(available / 3), 20_000);
  const newestBudget = available - firstBudget;
  return [
    truncateBlock(blocks[0]!, firstBudget),
    omission,
    truncateBlock(blocks.at(-1)!, newestBudget),
  ].join("\n\n");
}

export function buildThreadHandoffPackage(input: ThreadHandoffInput): ThreadHandoffPackage {
  const maxTextChars = input.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
  const messages = input.messages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  );
  const historyNote = input.hasOlderHistory
    ? "- History: Earlier server history was omitted from this package; inspect the source thread if needed."
    : "- History: All currently persisted conversation messages are included.";
  const header = [
    "You are taking over an existing task from another agent in T3 Code.",
    "",
    "Preserve the user's original intent and constraints. Continue the task; do not restart or repeat completed work.",
    "",
    "## Source",
    `- Thread: ${input.source.title} (${input.source.threadId})`,
    `- Branch: ${input.source.branch ?? "none"}`,
    `- Workspace: ${input.source.worktreePath ?? "the project checkout"}`,
    historyNote,
    "",
    "## Conversation",
  ].join("\n");
  const footer = [
    "## Resume",
    "Treat the workspace and git state as the source of truth for files and unfinished edits. Check git status first, then continue from the latest unresolved user request.",
  ].join("\n");
  const fixedChars = header.length + footer.length + 4;
  const conversation = boundedConversation(
    messages.map(messageBlock),
    Math.max(0, maxTextChars - fixedChars),
  );
  const text = `${header}\n${conversation}\n\n${footer}`.slice(0, maxTextChars);

  const attachments: ChatAttachment[] = [];
  const attachmentIds = new Set<string>();
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      if (
        attachments.length === PROVIDER_SEND_TURN_MAX_ATTACHMENTS ||
        attachmentIds.has(attachment.id) ||
        (attachment.type !== "image" && attachment.type !== "file")
      ) {
        continue;
      }
      attachmentIds.add(attachment.id);
      attachments.push(attachment);
    }
  }

  return { text, attachments };
}
