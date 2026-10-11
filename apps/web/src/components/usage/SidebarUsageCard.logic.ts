import type {
  EnvironmentId,
  ServerProvider,
  UsageMonitorMode,
  ModelSelection,
  ProviderInstanceId,
} from "@t3tools/contracts";
import type { LimitAccount } from "@t3tools/shared/usageLimits";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { DraftSessionState } from "../../composerDraftStore";
import { resolveActiveThreadRouteRef, type ThreadRouteTarget } from "../../threadRoutes";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { deriveLockedProvider, resolveComposerProviderSelection } from "../ChatView.logic";
import { usageMonitorRemainingPercent } from "../chat/usageMonitor";

export function sidebarUsageThreadRef(
  route: ThreadRouteTarget | null,
  draft: Pick<DraftSessionState, "environmentId" | "threadId" | "promotedTo"> | null,
) {
  return (
    resolveActiveThreadRouteRef(route, draft) ??
    (route?.kind === "draft" && draft ? scopeThreadRef(draft.environmentId, draft.threadId) : null)
  );
}

export function activeAccountRemaining(
  accounts: readonly LimitAccount[],
  environmentId: EnvironmentId | null,
  provider: ServerProvider | undefined,
  mode: UsageMonitorMode,
): number | null {
  if (!provider || !environmentId) return null;
  const email = provider.auth.email?.trim().toLowerCase();
  const fingerprint = provider.usageLimits?.credentialFingerprint;
  const account = accounts.find(
    (account) =>
      account.driver === provider.driver &&
      (email
        ? account.email?.trim().toLowerCase() === email
        : fingerprint
          ? account.limits.credentialFingerprint === fingerprint
          : account.key === `${environmentId}:${provider.instanceId}`),
  );
  return account ? (usageMonitorRemainingPercent(account.limits.windows, mode) ?? null) : null;
}

export function sidebarComposerProvider(input: {
  readonly providers: readonly ServerProvider[];
  readonly settings: Parameters<typeof applyProviderInstanceSettings>[1];
  readonly thread: Parameters<typeof deriveLockedProvider>[0]["thread"];
  readonly composerProvider: ProviderInstanceId | null;
  readonly defaultModel: ModelSelection | null | undefined;
}): ServerProvider | undefined {
  const { providers, settings, thread, composerProvider, defaultModel } = input;
  return resolveComposerProviderSelection({
    entries: sortProviderInstanceEntries(
      applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
    ),
    candidateInstanceIds: [
      composerProvider,
      thread?.runtime?.providerInstanceId,
      thread?.modelSelection.instanceId,
      defaultModel?.instanceId,
    ],
    lockedProvider: deriveLockedProvider({
      thread:
        thread?.runtime && thread.runtime.providerName === null
          ? {
              ...thread,
              runtime: {
                ...thread.runtime,
                providerName:
                  providers.find(
                    (provider) => provider.instanceId === thread.runtime?.providerInstanceId,
                  )?.driver ?? null,
              },
            }
          : thread,
      selectedProvider: composerProvider,
      threadProvider: thread?.modelSelection.instanceId ?? defaultModel?.instanceId ?? null,
      providers,
    }),
    lockedInstanceId: thread?.runtime?.providerInstanceId ?? thread?.modelSelection.instanceId,
  }).selectedProviderEntry?.snapshot;
}
