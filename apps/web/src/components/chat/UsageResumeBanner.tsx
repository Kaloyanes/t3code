import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { Clock3Icon } from "lucide-react";
import { useState } from "react";

import { useEnvironment } from "../../state/environments";
import { usageResumeEnvironment } from "../../state/usage-resumes";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

export function UsageResumeBanner({
  environmentId,
  threadId,
  timestampFormat,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly timestampFormat: TimestampFormat;
}) {
  const result = useAtomValue(
    usageResumeEnvironment.snapshot({ environmentId, input: { threadId } }),
  );
  const snapshot = Option.getOrNull(AsyncResult.value(result));
  const environment = useEnvironment(environmentId);
  const scheduleResume = useAtomCommand(usageResumeEnvironment.schedule);
  const cancelResume = useAtomCommand(usageResumeEnvironment.cancel);
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissedOutcome, setDismissedOutcome] = useState<string | null>(null);
  const schedule = snapshot?.schedule;
  const pending = schedule?.status === "pending" || schedule?.status === "dispatching";
  const failed = schedule?.status === "failed";
  const outcomeKey = schedule ? `${schedule.id}:${schedule.status}` : null;
  const showOutcome = schedule && !pending && outcomeKey !== dismissedOutcome;
  const eligibility = snapshot?.eligibility;
  const connected = environment?.connection.phase === "connected";
  const disabled = busy || !connected || AsyncResult.isFailure(result);

  if (!pending && !showOutcome && !eligibility?.available && !eligibility?.reason) return null;

  const scheduledAt = pending ? schedule.scheduledAt : eligibility?.resetsAt;
  const time = scheduledAt ? formatUpcomingTimestamp(scheduledAt, timestampFormat) : null;
  const run = async (action: "schedule" | "cancel") => {
    if (disabled) return;
    setBusy(true);
    setError(null);
    try {
      const outcome =
        action === "schedule"
          ? await scheduleResume({ environmentId, input: { threadId, prompt: prompt.trim() } })
          : schedule
            ? await cancelResume({ environmentId, input: { threadId, id: schedule.id } })
            : null;
      if (outcome && AsyncResult.isFailure(outcome)) {
        const failure = Cause.squash(outcome.cause);
        setError(
          failure instanceof Error ? failure.message : "Could not update the scheduled resume.",
        );
      } else {
        setEditing(false);
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not update the scheduled resume.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pointer-events-auto mb-2">
      <Alert variant={failed ? "warning" : "info"} surface="glass" role="status">
        <Clock3Icon />
        <AlertTitle>
          {pending
            ? "Resume scheduled on host"
            : failed
              ? "Scheduled resume stopped"
              : "Resume when usage resets"}
        </AlertTitle>
        <AlertDescription>
          {pending ? (
            <>
              <p>
                {schedule.status === "dispatching"
                  ? "Sending the continuation…"
                  : `Scheduled for ${time}. The host will check usage before sending.`}
              </p>
              <p className="line-clamp-3 whitespace-pre-wrap">{schedule.prompt}</p>
              {schedule.reason ? <p>{schedule.reason}</p> : null}
              {schedule.status === "pending" ? (
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={() => void run("cancel")}
                  >
                    {busy ? "Canceling…" : "Cancel resume"}
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              {showOutcome ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p>
                    {schedule.reason ??
                      (schedule.status === "dispatched"
                        ? "Continuation sent."
                        : schedule.status === "canceled"
                          ? "Scheduled resume canceled."
                          : "The scheduled resume failed.")}
                  </p>
                  <Button variant="ghost" size="xs" onClick={() => setDismissedOutcome(outcomeKey)}>
                    Dismiss
                  </Button>
                </div>
              ) : null}
              {eligibility?.available ? (
                <>
                  <p>The host can continue this thread at {time}, even with this app closed.</p>
                  {editing ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void run("schedule");
                      }}
                      className="flex flex-col gap-2"
                    >
                      <Textarea
                        aria-label="Message to send when usage resets"
                        size="sm"
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        maxLength={100_000}
                        disabled={busy}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit" size="sm" disabled={disabled || !prompt.trim()}>
                          {busy ? "Scheduling…" : "Schedule resume"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => setEditing(false)}
                        >
                          Back
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        onClick={() => {
                          setPrompt(eligibility.defaultPrompt ?? "");
                          setEditing(true);
                          setError(null);
                        }}
                      >
                        Resume when usage resets
                      </Button>
                    </div>
                  )}
                </>
              ) : eligibility?.reason ? (
                <p>{eligibility.reason}</p>
              ) : null}
            </>
          )}
          {pending || editing ? (
            <p>
              Keep the host awake and T3 running. Sending a message manually cancels this resume.
            </p>
          ) : null}
          {!connected ? <p>Reconnect to the host to manage this resume.</p> : null}
          {connected && AsyncResult.isFailure(result) ? (
            <p>Resume status is unavailable. Reconnect before making changes.</p>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </AlertDescription>
      </Alert>
    </div>
  );
}
