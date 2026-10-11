import { useAtomValue } from "@effect/atom-react";
import { useParams } from "@tanstack/react-router";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import {
  collectLimitAccounts,
  collectLimitNotices,
  collectLimitPools,
  displayLimitWindows,
} from "@t3tools/shared/usageLimits";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Schema from "effect/Schema";
import { RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import {
  useClientSettings,
  mergeEnvironmentSettings,
  usePrimarySettings,
} from "../../hooks/useSettings";
import { useProject, useThreadShell } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { environmentPresentations } from "../../state/presentation";
import { primaryServerSettingsAtom, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { resolveThreadRouteTarget } from "../../threadRoutes";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { providerClients } from "../settings/providerDriverMeta";
import { Button } from "../ui/button";
import { AnimatedNumber } from "../ui/changing-state";
import { Collapsible, CollapsiblePanel } from "../ui/collapsible";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { cn } from "../../lib/utils";
import { barColor } from "./UsageLimits";
import { PoolBar } from "./UsageLimitsPooled";
import {
  activeAccountRemaining,
  sidebarComposerProvider,
  sidebarUsageThreadRef,
} from "./SidebarUsageCard.logic";

export function SidebarUsageCard() {
  const route = useParams({ strict: false, select: resolveThreadRouteTarget });
  const draft = useComposerDraftStore((store) =>
    route?.kind === "draft" ? store.getDraftSession(route.draftId) : null,
  );
  const threadRef = useMemo(() => sidebarUsageThreadRef(route, draft), [route, draft]);
  const thread = useThreadShell(threadRef);
  const composerProvider = useComposerDraftStore((store) => {
    const target = route?.kind === "draft" ? route.draftId : threadRef;
    return target ? (store.getComposerDraft(target)?.activeProvider ?? null) : null;
  });
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentId = threadRef?.environmentId ?? primaryEnvironmentId;
  const serverSettings = useAtomValue(
    environmentId ? serverEnvironment.settingsValueAtom(environmentId) : primaryServerSettingsAtom,
  );
  const clientSettings = useClientSettings();
  const settings = useMemo(
    () => mergeEnvironmentSettings(serverSettings ?? DEFAULT_SERVER_SETTINGS, clientSettings),
    [serverSettings, clientSettings],
  );
  const mode = useClientSettings((settings) => settings.usageMonitorMode);
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const projectId = thread?.projectId ?? draft?.projectId;
  const project = useProject(
    environmentId && projectId ? scopeProjectRef(environmentId, projectId) : null,
  );
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const connected = useMemo(
    () =>
      new Map(
        [...presentations].filter(
          ([, presentation]) =>
            presentation.connection.phase === "connected" && presentation.serverConfig !== null,
        ),
      ),
    [presentations],
  );
  const providers = environmentId
    ? (connected.get(environmentId)?.serverConfig?.providers ?? [])
    : [];
  const activeProvider = useMemo(() => {
    if (!threadRef) return undefined;
    const defaultModel = resolveProjectSettings(settings, project?.id ?? null, project ?? undefined)
      .settings.defaultModelSelection;
    return sidebarComposerProvider({ providers, settings, thread, composerProvider, defaultModel });
  }, [composerProvider, project, providers, settings, thread, threadRef]);
  const accounts = useMemo(() => collectLimitAccounts(connected), [connected]);
  const [expanded, setExpanded] = useLocalStorage(
    "t3code:sidebar-usage-expanded",
    false,
    Schema.Boolean,
  );
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!expanded) return;
    const updateClock = () => setNow(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 60_000);
    document.addEventListener("visibilitychange", updateClock);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", updateClock);
    };
  }, [expanded]);
  const pools = useMemo(() => collectLimitPools(accounts, now), [accounts, now]);
  const notices = useMemo(() => collectLimitNotices(connected), [connected]);
  const remaining = activeAccountRemaining(accounts, environmentId, activeProvider, mode);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailure, setRefreshFailure] = useState(false);
  const pendingRefreshCount = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const refresh = useCallback(
    async (automatic = true) => {
      pendingRefreshCount.current += 1;
      setRefreshing(true);
      try {
        const results = await Promise.all(
          [...connected.keys()].map((environmentId) =>
            refreshUsageLimits(
              environmentId,
              () => refreshProviders({ environmentId, input: {} }),
              automatic,
            ),
          ),
        );
        if (mounted.current && results.some((result) => result !== undefined))
          setRefreshFailure(results.some((result) => result?._tag === "Failure"));
      } catch {
        if (mounted.current) setRefreshFailure(true);
      } finally {
        pendingRefreshCount.current -= 1;
        if (mounted.current) {
          setRefreshing(pendingRefreshCount.current > 0);
          setNow(Date.now());
        }
      }
    },
    [connected, refreshProviders],
  );
  const connectionKey = [...connected.keys()].sort().join("\u0000");
  const automaticRefresh = useEffectEvent(() => {
    void refresh();
  });
  const lastConnectionKey = useRef<string | null>(null);
  useEffect(() => {
    if (lastConnectionKey.current !== connectionKey || expanded) automaticRefresh();
    lastConnectionKey.current = connectionKey;
  }, [connectionKey, expanded]);

  return (
    <Collapsible open={expanded} className="flex flex-col">
      <CollapsiblePanel>
        <div className="max-h-[45vh] space-y-3 overflow-y-auto px-2 pt-1 pb-2">
          {pools.length === 0 ? (
            <p className="text-2xs text-muted-foreground">
              No connected provider reports subscription limits.
            </p>
          ) : (
            pools.map((pool) => (
              <section key={pool.driver}>
                <h3 className="text-xs font-medium">
                  {providerClients.get(pool.driver)?.label ?? pool.driver}
                </h3>
                <div className="mt-1 space-y-2">
                  {displayLimitWindows(pool).map((window) => {
                    // The bar already shows a lone account's countdown; pooled bars need the refill.
                    const nextRefill =
                      window.columns.length > 1
                        ? window.resets.find((reset) => reset.restoresPercent > 0)
                        : undefined;
                    return (
                      <div key={window.id} className="space-y-1">
                        <div className="flex justify-between gap-2 text-2xs text-muted-foreground">
                          <span>{window.label}</span>
                          {window.columns.length > 1 ? (
                            <span className="tabular-nums">
                              <AnimatedNumber value={window.remainingPercent} />% left
                            </span>
                          ) : null}
                        </div>
                        <PoolBar pool={window} color={barColor(pool.driver)} now={now} compact />
                        {nextRefill ? (
                          <p className="text-3xs text-muted-foreground tabular-nums">
                            ↻ +{Math.round(nextRefill.restoresPercent)}%{" "}
                            {formatUpcomingTimestamp(
                              new Date(nextRefill.at).toISOString(),
                              timestampFormat,
                              now,
                            )}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
          {notices.map((notice) => (
            <p key={notice} className="break-words text-2xs text-warning-foreground">
              {notice}
            </p>
          ))}
        </div>
      </CollapsiblePanel>
      <div className="mx-0.5 flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <CollapsibleSectionHeader
            expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            accessory={
              <span className="shrink-0 tabular-nums text-sidebar-muted-foreground">
                {remaining === null ? (
                  "Unknown"
                ) : (
                  <>
                    <AnimatedNumber value={remaining} />%
                  </>
                )}
              </span>
            }
          >
            Usage
          </CollapsibleSectionHeader>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Refresh usage limits"
          disabled={refreshing}
          onClick={() => void refresh(false)}
        >
          <RefreshCwIcon className={cn("size-3", refreshing && "animate-spin")} />
        </Button>
      </div>
      {refreshFailure ? (
        <p role="status" className="px-2 pb-1 text-2xs text-warning-foreground">
          Could not refresh all usage limits.
        </p>
      ) : null}
    </Collapsible>
  );
}
