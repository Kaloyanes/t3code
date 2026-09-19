import type { IssueLinkedWork, WorktreePullRequestLink } from "@t3tools/contracts";

export function issuesToCompleteOnMerge(input: {
  readonly enabled: boolean;
  readonly issues: ReadonlyArray<IssueLinkedWork>;
  readonly pullRequests: ReadonlyArray<WorktreePullRequestLink>;
}): ReadonlyArray<IssueLinkedWork> {
  if (!input.enabled) return [];
  const result: IssueLinkedWork[] = [];
  for (const worktreePath of new Set(input.pullRequests.map((link) => link.worktreePath))) {
    const pullRequests = input.pullRequests.filter((link) => link.worktreePath === worktreePath);
    if (!pullRequests.every((link) => link.snapshot?.state === "merged")) continue;
    const issues = input.issues.filter((link) => link.worktreePath === worktreePath);
    if (issues.length === 1) result.push(issues[0]!);
  }
  return result;
}
