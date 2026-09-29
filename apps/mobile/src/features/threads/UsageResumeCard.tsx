import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { useState } from "react";
import { ScrollView, TextInput, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { usageResumeEnvironment } from "../../state/usage-resumes";
import { RequestActionButton } from "./RequestActionButton";

export function UsageResumeCard({
  environmentId,
  threadId,
  threadError,
  connected,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly threadError: string | null;
  readonly connected: boolean;
}) {
  const snapshot = useEnvironmentQuery(
    usageResumeEnvironment.snapshot({ environmentId, input: { threadId } }),
  );
  const schedule = useAtomCommand(usageResumeEnvironment.schedule);
  const cancel = useAtomCommand(usageResumeEnvironment.cancel);
  const [draft, setDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = snapshot.data?.schedule;
  const eligibility = snapshot.data?.eligibility;
  const active = current?.status === "pending" || current?.status === "dispatching";
  const available = Boolean(threadError && eligibility?.available);
  const unavailable = Boolean(threadError && eligibility?.reason);
  const disabled = busy || !connected || snapshot.error !== null;
  const prompt = draft ?? eligibility?.defaultPrompt ?? "";

  const submit = async (canceling: boolean) => {
    if (disabled) return;
    setBusy(true);
    setError(null);
    try {
      const result =
        canceling && current
          ? await cancel({ environmentId, input: { threadId, id: current.id } })
          : await schedule({ environmentId, input: { threadId, prompt: prompt.trim() } });
      if (result._tag === "Failure") {
        const failure = Cause.squash(result.cause);
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

  if (!current && !available && !unavailable) return null;
  if (!snapshot.data && !snapshot.error) return null;

  return (
    <View className="px-4 pb-3">
      <View className="gap-2.5 rounded-[20px] border border-border-subtle bg-card-alt p-4">
        <Text accessibilityRole="header" className="font-t3-bold text-sm text-foreground">
          {active ? "Resume scheduled" : "Resume when usage resets"}
        </Text>
        {current ? (
          <>
            <Text className="text-xs text-foreground-secondary" accessibilityLiveRegion="polite">
              {current.status === "pending"
                ? `Scheduled for ${new Date(current.scheduledAt).toLocaleString()}`
                : current.status === "dispatching"
                  ? "Sending the continuation prompt…"
                  : current.status === "dispatched"
                    ? "Continuation prompt sent."
                    : current.status === "canceled"
                      ? "Scheduled resume canceled."
                      : (current.reason ?? "The scheduled resume failed.")}
            </Text>
            {active && current.reason ? (
              <Text className="text-xs text-foreground-secondary">{current.reason}</Text>
            ) : null}
            {active ? (
              <ScrollView style={{ maxHeight: 100 }}>
                <Text selectable className="text-sm text-foreground-secondary">
                  {current.prompt}
                </Text>
              </ScrollView>
            ) : null}
          </>
        ) : null}
        {active ? (
          <>
            <Text className="text-xs text-foreground-muted">
              The host must remain running and connected.
            </Text>
            {current?.status === "pending" ? (
              <RequestActionButton
                label={busy ? "Canceling…" : "Cancel scheduled resume"}
                tone="secondary"
                disabled={disabled}
                onPress={() => void submit(true)}
              />
            ) : null}
          </>
        ) : available ? (
          editing ? (
            <>
              <Text className="text-xs text-foreground-secondary">
                {eligibility?.resetsAt
                  ? `After ${new Date(eligibility.resetsAt).toLocaleString()}. `
                  : ""}
                The host will send this prompt once. Keep the host running and connected.
              </Text>
              <TextInput
                accessibilityLabel="Continuation prompt"
                multiline
                value={prompt}
                onChangeText={setDraft}
                editable={!disabled}
                maxLength={100_000}
                className="min-h-20 max-h-32 rounded-xl border border-border-subtle p-3 text-sm text-foreground"
              />
              <View className="flex-row flex-wrap gap-2">
                <RequestActionButton
                  label={busy ? "Scheduling…" : "Schedule resume"}
                  disabled={disabled || !prompt.trim()}
                  onPress={() => void submit(false)}
                />
                <RequestActionButton
                  label="Back"
                  tone="secondary"
                  disabled={busy}
                  onPress={() => setEditing(false)}
                />
              </View>
            </>
          ) : (
            <RequestActionButton
              label="Resume when usage resets"
              disabled={disabled}
              onPress={() => setEditing(true)}
            />
          )
        ) : unavailable ? (
          <Text className="text-xs text-foreground-secondary">
            {eligibility?.reason ?? snapshot.error ?? "No reliable usage reset time is available."}
          </Text>
        ) : null}
        {!connected ? (
          <Text className="text-xs text-foreground-secondary">
            Reconnect to update the scheduled resume.
          </Text>
        ) : null}
        {error || snapshot.error ? (
          <Text accessibilityRole="alert" className="text-xs text-danger-foreground">
            {error ?? snapshot.error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
