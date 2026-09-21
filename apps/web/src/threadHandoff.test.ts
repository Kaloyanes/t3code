import {
  ComposerContextId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  type ChatAttachment,
  type OrchestrationMessageContext,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildThreadHandoffPackage } from "./threadHandoff";

const attachment = (id: string): ChatAttachment => ({
  type: "image",
  id,
  name: `${id}.png`,
  mimeType: "image/png",
  sizeBytes: 12,
});

describe("buildThreadHandoffPackage", () => {
  it("preserves user intent, actionable history, workspace identity, and structured context", () => {
    const context = {
      version: 1,
      records: [
        {
          version: 1,
          contextId: ComposerContextId.make("terminal_build"),
          kind: "terminal",
          label: "Build lines 4-5",
          terminalId: "build",
          terminalLabel: "Build",
          lineStart: 4,
          lineEnd: 5,
          text: "Type error\nBuild failed",
        },
      ],
    } satisfies OrchestrationMessageContext;

    const handoff = buildThreadHandoffPackage({
      source: {
        title: "Add provider handoff",
        threadId: "thread_source",
        branch: "feature/handoff",
        worktreePath: "/worktrees/handoff",
      },
      hasOlderHistory: false,
      messages: [
        { role: "system", text: "provider internals" },
        { role: "user", text: "Keep the existing behavior." },
        { role: "reasoning", text: "private reasoning" },
        { role: "assistant", text: "I added the first slice." },
        { role: "user", text: "Fix the build reference", context },
      ],
    });

    expect(handoff.text).toContain("Keep the existing behavior.");
    expect(handoff.text).toContain("I added the first slice.");
    expect(handoff.text).toContain("Type error");
    expect(handoff.text).toContain("feature/handoff");
    expect(handoff.text).toContain("/worktrees/handoff");
    expect(handoff.text).not.toContain("provider internals");
    expect(handoff.text).not.toContain("private reasoning");
  });

  it("deduplicates durable attachments and respects the provider turn limit", () => {
    const attachments = Array.from({ length: PROVIDER_SEND_TURN_MAX_ATTACHMENTS + 2 }, (_, index) =>
      attachment(`image_${index}`),
    );
    const handoff = buildThreadHandoffPackage({
      source: { title: "Attachments", threadId: "thread_source" },
      hasOlderHistory: false,
      messages: [
        { role: "user", text: "Use these", attachments },
        { role: "assistant", text: "Seen", attachments: [attachments[0]!] },
      ],
    });

    expect(handoff.attachments).toHaveLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS);
    expect(new Set(handoff.attachments.map(({ id }) => id)).size).toBe(
      PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
    );
  });

  it("keeps the original request and newest work when history must be bounded", () => {
    const handoff = buildThreadHandoffPackage({
      source: { title: "Long thread", threadId: "thread_source" },
      hasOlderHistory: true,
      maxTextChars: 900,
      messages: [
        { role: "user", text: "ORIGINAL USER INTENT" },
        ...Array.from({ length: 10 }, (_, index) => ({
          role: "assistant" as const,
          text: `stale update ${index} ${"x".repeat(180)}`,
        })),
        { role: "user", text: "LATEST UNRESOLVED REQUEST" },
      ],
    });

    expect(handoff.text.length).toBeLessThanOrEqual(900);
    expect(handoff.text).toContain("ORIGINAL USER INTENT");
    expect(handoff.text).toContain("LATEST UNRESOLVED REQUEST");
    expect(handoff.text).toContain("history was omitted");
  });
});
