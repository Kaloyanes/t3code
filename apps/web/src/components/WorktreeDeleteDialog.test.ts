import type { VcsStatusResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { worktreeDeletionPreflightReason } from "./WorktreeDeleteDialog";

const cleanStatus: VcsStatusResult = {
  isRepo: true,
  hasPrimaryRemote: true,
  isDefaultRef: false,
  refName: "feature/a",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 0,
  pr: null,
};

describe("worktree deletion preflight", () => {
  it("waits for Git status and blocks local changes", () => {
    expect(worktreeDeletionPreflightReason(null, null)).toContain("Checking");
    expect(
      worktreeDeletionPreflightReason({ ...cleanStatus, hasWorkingTreeChanges: true }, null),
    ).toContain("Commit or discard");
  });

  it("allows a clean worktree and reports status failures", () => {
    expect(worktreeDeletionPreflightReason(cleanStatus, null)).toBeNull();
    expect(worktreeDeletionPreflightReason(null, "Connection lost")).toContain("Connection lost");
  });
});
