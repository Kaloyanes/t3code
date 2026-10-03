import type { IssueState, IssueStateReason } from "@t3tools/contracts";

import { cn } from "~/lib/utils";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ISSUE_STATE_PRESENTATION, issuePresentationState } from "./issuePresentation";

export function resolveIssueState(input: {
  readonly state: IssueState;
  readonly stateReason?: IssueStateReason | undefined;
}) {
  return ISSUE_STATE_PRESENTATION[
    issuePresentationState({ state: input.state, stateReason: input.stateReason ?? null })
  ];
}

/** An issue's state as one glyph, the issue counterpart of `PullRequestStateGlyph`. */
export function IssueStateGlyph({
  state,
  stateReason,
  className,
}: {
  state: IssueState;
  stateReason?: IssueStateReason | undefined;
  className?: string;
}) {
  const presentation = resolveIssueState({ state, stateReason });
  return (
    <Tooltip>
      {/* A span, like the pull request glyph: rows that hold it are often buttons themselves. */}
      <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
        <presentation.Icon
          role="img"
          aria-label={presentation.label}
          className={cn("size-4 shrink-0", presentation.toneClassName, className)}
        />
      </TooltipTrigger>
      <TooltipPopup>{presentation.label}</TooltipPopup>
    </Tooltip>
  );
}
