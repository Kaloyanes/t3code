import type { VcsRef } from "@t3tools/contracts";

import { resolveExistingWorktreeOptions } from "../BranchToolbar.logic";

export function resolveProjectWorktreeOptions(input: {
  refs: ReadonlyArray<Pick<VcsRef, "name" | "current" | "worktreePath">>;
  workspaceRoot: string;
  repositoryRoot: string;
}) {
  const current = input.refs.find((ref) => ref.current && ref.worktreePath);
  return [
    ...(current ? [{ branch: current.name, worktreePath: input.workspaceRoot }] : []),
    ...resolveExistingWorktreeOptions({
      ...input,
      repositoryRoot: current?.worktreePath ?? input.repositoryRoot,
    }),
  ];
}

export function projectGroupTitleNeedsUpdate(
  memberTitles: ReadonlyArray<string>,
  nextTitle: string,
  wasEdited: boolean,
): boolean {
  return wasEdited && memberTitles.some((title) => title !== nextTitle);
}
