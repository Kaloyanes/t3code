import type { IssueWorktreeDeleteDecision, IssueWorktreeDeleteIssue } from "@t3tools/contracts";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

export function worktreeIssueKey(issue: IssueWorktreeDeleteIssue | IssueWorktreeDeleteDecision) {
  return `${issue.projectId}:${issue.host}:${issue.repository}:${issue.number}`;
}

export function WorktreeIssueDecisions(props: {
  issues: ReadonlyArray<IssueWorktreeDeleteIssue>;
  decisions: ReadonlyArray<IssueWorktreeDeleteDecision>;
  onChange: (decisions: IssueWorktreeDeleteDecision[]) => void;
  disabled?: boolean;
}) {
  const issues = [
    ...new Map(props.issues.map((issue) => [worktreeIssueKey(issue), issue])).values(),
  ];
  if (issues.length === 0) return null;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">Issue links and thread history will be kept.</p>
      {issues.map((issue) => {
        const key = worktreeIssueKey(issue);
        const label = `${issue.repository}#${issue.number}`;
        if (issue.state === "closed") return <p key={key}>{label} is closed.</p>;
        const actions = [
          { value: "keep-open", label: issue.state === null ? "Leave unchanged" : "Keep open" },
          { value: "completed", label: "Close as completed" },
          { value: "not-planned", label: "Close as not planned" },
        ];
        return (
          <div key={key} className="space-y-1">
            <p>
              {label}
              {issue.state === null
                ? ": status unavailable. Leave unchanged or choose a close action."
                : " is open."}
            </p>
            <Select<IssueWorktreeDeleteDecision["action"]>
              items={actions}
              value={
                props.decisions.find((item) => worktreeIssueKey(item) === key)?.action ??
                "keep-open"
              }
              disabled={props.disabled}
              onValueChange={(action) => {
                if (action)
                  props.onChange([
                    ...props.decisions.filter((item) => worktreeIssueKey(item) !== key),
                    { ...issue, action },
                  ]);
              }}
            >
              <SelectTrigger aria-label={`Action for ${label}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {actions.map((action) => (
                  <SelectItem key={action.value} value={action.value}>
                    {action.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        );
      })}
    </div>
  );
}
