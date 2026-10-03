import type {
  EnvironmentId,
  IssueActor,
  IssueDetail,
  IssueRef,
  IssueRelatedIssue,
  IssueTimelineEvent,
  IssueTimelineSource,
  ScopedThreadRef,
} from "@t3tools/contracts";
import {
  LinkIcon,
  MessageSquareIcon,
  MilestoneIcon,
  PencilIcon,
  TagIcon,
  UserIcon,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { cn } from "~/lib/utils";
import { useOpenPrLink } from "~/lib/openPullRequestLink";
import { useIssueTimeline } from "~/state/issues";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PullRequestActivityUnavailableState } from "../pullRequest/PullRequestActivityUnavailableState";
import { PullRequestCommentBody } from "../pullRequest/PullRequestCommentBody";
import { GhostBar } from "../pullRequest/PullRequestGhosts";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { ReactionBar } from "../pullRequest/PullRequestReactions";
import { ActorName, ActorTimelineMarker, IconMarker } from "../pullRequest/PullRequestTimelineTab";
import { PullRequestLabelChip } from "../pullRequest/pullRequestPresentation";
import { groupIssueTimelineEvents, issueCloseReasonPhrase } from "./issueDetail.logic";
import { ISSUE_STATE_PRESENTATION } from "./issuePresentation";
import { resolveIssueState } from "./IssueStateGlyph";
import { IssueReferenceButton } from "./IssueSummaryTab";

const TIMELINE_PAGE_SIZE = 50;

interface TimelineContext {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef | null;
  readonly cwd: string;
  readonly onOpenSource: (event: ReactMouseEvent<HTMLElement>, source: IssueTimelineSource) => void;
}

function TimeLine({ at, url }: { at: string; url?: string | null }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 block w-fit text-2xs text-muted-foreground hover:text-foreground hover:underline"
            />
          ) : (
            <span className="mt-0.5 block w-fit text-2xs text-muted-foreground" />
          )
        }
      >
        <time dateTime={at}>{formatRelativeTimeLabel(at)}</time>
      </TooltipTrigger>
      <TooltipPopup>
        {new Date(at).toLocaleString()}
        {url ? " · Open on GitHub" : ""}
      </TooltipPopup>
    </Tooltip>
  );
}

/** One line of what happened, on the rail beside its glyph — the pull request timeline's row. */
function EventRow({
  icon,
  actor,
  at,
  children,
}: {
  icon: ReactNode;
  actor: IssueActor | null;
  at: string;
  children: ReactNode;
}) {
  return (
    <div className="relative mb-5 pl-12 [contain-intrinsic-block-size:40px] [content-visibility:auto]">
      <IconMarker icon={icon} />
      <div className="py-1.5 text-xs">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-muted-foreground">
          <ActorName actor={actor} />
          {children}
        </div>
        <TimeLine at={at} />
      </div>
    </div>
  );
}

function Logins({ actors }: { actors: ReadonlyArray<IssueActor> }) {
  return (
    <>
      {actors.map((actor, index) => (
        <span key={actor.login}>
          {index > 0 ? ", " : null}
          <span className="font-semibold text-foreground">{actor.login}</span>
        </span>
      ))}
    </>
  );
}

function sourceAsIssue(source: IssueTimelineSource): IssueRelatedIssue {
  return {
    number: source.number,
    title: source.title,
    url: source.url,
    state: source.state === "open" ? "open" : "closed",
    repository: source.repository,
  };
}

function SourceReference({
  source,
  context,
}: {
  source: IssueTimelineSource;
  context: TimelineContext;
}) {
  return source.kind === "pull-request" ? (
    <IssueReferenceButton
      item={source}
      kind="pull-request"
      onOpen={(event) => context.onOpenSource(event, source)}
    />
  ) : (
    <IssueReferenceButton
      item={sourceAsIssue(source)}
      kind="issue"
      onOpen={(event) => context.onOpenSource(event, source)}
    />
  );
}

function CommentEvent({
  event,
  context,
}: {
  event: Extract<IssueTimelineEvent, { _tag: "comment" }>;
  context: TimelineContext;
}) {
  return (
    <div className="relative mb-5 pl-12 [contain-intrinsic-block-size:120px] [content-visibility:auto]">
      {/* Pinned rather than centred: the row grows with its body. */}
      <ActorTimelineMarker
        actors={event.actor ? [event.actor] : []}
        className="top-6"
        fallback={<MessageSquareIcon className="size-3.5" />}
      />
      <div className="flex min-w-0 flex-wrap items-start gap-2 py-1.5">
        <div className="min-w-0 flex-1 text-xs">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-muted-foreground">
            <ActorName actor={event.actor} />
            commented
          </div>
          <TimeLine at={event.createdAt} url={event.comment.url} />
        </div>
        <ReactionBar
          className="ml-auto justify-end"
          reactions={event.comment.reactions ?? []}
          canReact={false}
          onSetReaction={async () => false}
        />
      </div>
      <PullRequestCommentBody
        className="mt-1"
        text={event.comment.body}
        cwd={context.cwd}
        environmentId={context.environmentId}
        threadRef={context.threadRef}
      />
    </div>
  );
}

function TimelineEventRow({
  event,
  context,
}: {
  event: IssueTimelineEvent;
  context: TimelineContext;
}) {
  switch (event._tag) {
    case "comment":
      return <CommentEvent event={event} context={context} />;
    case "closed": {
      const presentation = resolveIssueState({ state: "closed", stateReason: event.stateReason });
      return (
        <EventRow
          icon={<presentation.Icon className={cn("size-3.5", presentation.toneClassName)} />}
          actor={event.actor}
          at={event.createdAt}
        >
          {issueCloseReasonPhrase(event.stateReason)}
        </EventRow>
      );
    }
    case "reopened":
      return (
        <EventRow
          icon={
            <ISSUE_STATE_PRESENTATION.open.Icon
              className={cn("size-3.5", ISSUE_STATE_PRESENTATION.open.toneClassName)}
            />
          }
          actor={event.actor}
          at={event.createdAt}
        >
          reopened this
        </EventRow>
      );
    case "renamed":
      return (
        <EventRow
          icon={<PencilIcon className="size-3.5" />}
          actor={event.actor}
          at={event.createdAt}
        >
          changed the title <del className="min-w-0 break-words">{event.from}</del>
          <span className="min-w-0 break-words text-foreground">{event.to}</span>
        </EventRow>
      );
    case "referenced":
    case "cross-referenced":
      return (
        <EventRow
          icon={
            event.source.kind === "pull-request" ? (
              <PullRequestGlyph.pullRequest className="size-3.5" />
            ) : (
              <LinkIcon className="size-3.5" />
            )
          }
          actor={event.actor}
          at={event.createdAt}
        >
          {event._tag === "referenced" ? "referenced this in" : "mentioned this in"}
          <SourceReference source={event.source} context={context} />
        </EventRow>
      );
    case "connected":
      return (
        <EventRow
          icon={<PullRequestGlyph.link className="size-3.5" />}
          actor={event.actor}
          at={event.createdAt}
        >
          linked a pull request that will close this
          <SourceReference
            source={{ ...event.pullRequest, kind: "pull-request" }}
            context={context}
          />
        </EventRow>
      );
    case "milestoned":
    case "demilestoned":
      return (
        <EventRow
          icon={<MilestoneIcon className="size-3.5" />}
          actor={event.actor}
          at={event.createdAt}
        >
          {event._tag === "milestoned" ? "added this to" : "removed this from"}
          <span className="font-semibold text-foreground">{event.title}</span>
          milestone
        </EventRow>
      );
    // Grouped into runs before they get here; kept so a lone one still reads.
    case "labeled":
    case "unlabeled":
      return (
        <EventRow icon={<TagIcon className="size-3.5" />} actor={event.actor} at={event.createdAt}>
          {event._tag === "labeled" ? "added" : "removed"}
          <PullRequestLabelChip label={event.label} />
        </EventRow>
      );
    case "assigned":
    case "unassigned":
      return (
        <EventRow icon={<UserIcon className="size-3.5" />} actor={event.actor} at={event.createdAt}>
          {event._tag === "assigned" ? "assigned" : "unassigned"}
          {event.assignee ? <Logins actors={[event.assignee]} /> : null}
        </EventRow>
      );
  }
}

/** One page of the host's timeline: oldest first, with the way to the next page at its end. */
function IssueTimelinePage({
  reference,
  cursor,
  isLast,
  refreshToken,
  context,
  onLoadMore,
}: {
  reference: IssueRef;
  cursor: string | undefined;
  isLast: boolean;
  refreshToken: number;
  context: TimelineContext;
  onLoadMore: (cursor: string) => void;
}) {
  const query = useIssueTimeline({
    environmentId: context.environmentId,
    input: {
      ...reference,
      ...(cursor === undefined ? {} : { cursor }),
      limit: TIMELINE_PAGE_SIZE,
    },
  });
  // The panel says when the issue changed; each page asks the host again for its own slice.
  const appliedToken = useRef(refreshToken);
  const { refresh } = query;
  useEffect(() => {
    if (appliedToken.current === refreshToken) return;
    appliedToken.current = refreshToken;
    refresh();
  }, [refresh, refreshToken]);

  if (query.data === null) {
    return query.error ? (
      <div className="pl-12">
        <PullRequestActivityUnavailableState
          compact
          title="Could not load the timeline"
          error={query.error}
          onRetry={query.refresh}
        />
      </div>
    ) : (
      <div role="status" aria-label="Loading timeline" className="motion-safe:animate-skeleton">
        {[0, 1, 2].map((index) => (
          <div key={index} className="relative mb-5 pl-12">
            <GhostBar className="absolute left-2 top-1/2 size-4 -translate-y-1/2 rounded-full" />
            <GhostBar className={cn("h-3.5", index === 1 ? "w-2/5" : "w-3/5")} />
            <GhostBar className="mt-1.5 w-16" />
          </div>
        ))}
      </div>
    );
  }

  const rows = groupIssueTimelineEvents(query.data.events);
  const nextCursor = query.data.nextCursor;
  return (
    <>
      {rows.map((row) => {
        if (row.kind === "event") {
          return <TimelineEventRow key={row.event.id} event={row.event} context={context} />;
        }
        if (row.kind === "labels") {
          return (
            <EventRow
              key={row.id}
              icon={<TagIcon className="size-3.5" />}
              actor={row.actor}
              at={row.at}
            >
              {row.added.length > 0 ? "added" : null}
              {row.added.map((label) => (
                <PullRequestLabelChip key={label.name} label={label} />
              ))}
              {row.added.length > 0 && row.removed.length > 0 ? "and" : null}
              {row.removed.length > 0 ? "removed" : null}
              {row.removed.map((label) => (
                <PullRequestLabelChip key={label.name} label={label} />
              ))}
              {row.added.length + row.removed.length === 1 ? "label" : "labels"}
            </EventRow>
          );
        }
        const selfAssigned =
          row.removed.length === 0 &&
          row.added.length === 1 &&
          row.added[0]?.login === row.actor?.login;
        return (
          <EventRow
            key={row.id}
            icon={<UserIcon className="size-3.5" />}
            actor={row.actor}
            at={row.at}
          >
            {selfAssigned ? (
              "self-assigned this"
            ) : (
              <>
                {row.added.length > 0 ? (
                  <>
                    assigned <Logins actors={row.added} />
                  </>
                ) : null}
                {row.added.length > 0 && row.removed.length > 0 ? " and " : null}
                {row.removed.length > 0 ? (
                  <>
                    unassigned <Logins actors={row.removed} />
                  </>
                ) : null}
              </>
            )}
          </EventRow>
        );
      })}
      {isLast && nextCursor !== null ? (
        <div className="relative pb-2 pl-12">
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => onLoadMore(nextCursor)}
          >
            Load more activity
          </Button>
        </div>
      ) : null}
    </>
  );
}

export function IssueTimelineTab({
  environmentId,
  threadRef,
  reference,
  issue,
  cwd,
  refreshToken,
  onOpenRelatedIssue,
}: {
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef | null;
  reference: IssueRef;
  issue: IssueDetail;
  cwd: string;
  /** Bumped by the panel whenever the issue changed on the host. */
  refreshToken: number;
  onOpenRelatedIssue: (issue: IssueRelatedIssue) => void;
}) {
  // Each later page is its own read, named by the cursor the page before it handed back.
  const [cursors, setCursors] = useState<ReadonlyArray<string>>([]);
  const openPrLink = useOpenPrLink(threadRef ?? undefined);
  const context: TimelineContext = {
    environmentId,
    threadRef,
    cwd,
    onOpenSource: (event, source) => {
      if (source.kind === "pull-request") openPrLink(event, source.url);
      else onOpenRelatedIssue(sourceAsIssue(source));
    },
  };
  const pages: ReadonlyArray<string | undefined> = [undefined, ...cursors];
  const opened = ISSUE_STATE_PRESENTATION.open;

  return (
    <div className="h-full overflow-y-auto px-4 py-5">
      <div className="mx-auto max-w-3xl">
        <div className="relative">
          <span aria-hidden className="absolute bottom-5 left-[15px] top-1 w-px bg-border/45" />
          <EventRow
            icon={<opened.Icon className={cn("size-3.5", opened.toneClassName)} />}
            actor={issue.author}
            at={issue.createdAt}
          >
            opened this issue
          </EventRow>
          {pages.map((cursor, index) => (
            <IssueTimelinePage
              key={cursor ?? "first"}
              reference={reference}
              cursor={cursor}
              isLast={index === pages.length - 1}
              refreshToken={refreshToken}
              context={context}
              onLoadMore={(next) =>
                setCursors((current) => (current.includes(next) ? current : [...current, next]))
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}
