import { describe, expect, it } from "vite-plus/test";
import { canDeleteLocalBranch } from "./vcsRef.ts";

const localBranch = { name: "feature", current: false, isDefault: false, worktreePath: null };

describe("canDeleteLocalBranch", () => {
  it("allows local branches that are not checked out", () => {
    expect(canDeleteLocalBranch(localBranch)).toBe(true);
  });

  it.each([
    { ...localBranch, current: true },
    { ...localBranch, worktreePath: "/worktrees/feature" },
    { ...localBranch, isRemote: true },
  ])("rejects current, worktree, and remote refs: %j", (ref) => {
    expect(canDeleteLocalBranch(ref)).toBe(false);
  });
});
