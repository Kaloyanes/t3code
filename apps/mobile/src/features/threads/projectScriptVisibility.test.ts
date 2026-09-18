import { describe, expect, it } from "vite-plus/test";

import { threadProjectScripts } from "./projectScriptVisibility";

describe("threadProjectScripts", () => {
  it("keeps legacy and explicit thread actions but hides worktree actions", () => {
    const scripts = [
      {
        id: "legacy",
        name: "Legacy",
        command: "echo legacy",
        icon: "play" as const,
        runOnWorktreeCreate: false,
      },
      {
        id: "thread",
        name: "Thread",
        command: "echo thread",
        icon: "play" as const,
        scope: "thread" as const,
        runOnWorktreeCreate: false,
      },
      {
        id: "dev",
        name: "Dev",
        command: "pnpm dev",
        icon: "debug" as const,
        scope: "worktree" as const,
        runOnWorktreeCreate: false,
      },
    ];

    expect(threadProjectScripts(scripts).map((script) => script.id)).toEqual(["legacy", "thread"]);
  });
});
