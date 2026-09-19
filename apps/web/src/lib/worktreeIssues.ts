import type { IssueLinkedWork } from "@t3tools/contracts";
import { normalizeProjectPathForComparison } from "./projectPaths";

export function findWorktreeIssue(input: {
  readonly issues: readonly IssueLinkedWork[];
  readonly workspacePath: string;
  readonly projectRoot: string;
}): IssueLinkedWork | null {
  const workspacePath = normalizeProjectPathForComparison(input.workspacePath);
  return (
    input.issues.find(
      (link) =>
        normalizeProjectPathForComparison(link.worktreePath ?? input.projectRoot) === workspacePath,
    ) ?? null
  );
}
