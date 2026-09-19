import { useAtomValue } from "@effect/atom-react";
import {
  type EnvironmentId,
  type ProviderConsumeResetCreditInput,
  type ProviderConsumeResetCreditOutcome,
  type ProviderDriverKind,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  collectLimitAccounts,
  collectLimitNotices,
  remainingPercent,
  type LimitAccount,
} from "@t3tools/shared/usageLimits";
import { AlertTriangleIcon, GaugeIcon, TicketIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { RefreshIcon } from "../ui/refresh-icon";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";
import { DRIVER_OPTIONS, getDriverOption } from "../settings/providerDriverMeta";
import { LimitWindows, ResetCreditDialog, resetCreditsSummary } from "../usage/UsageLimits";
import { usageLimitBarColor } from "../usage/usageLimitColors";
import { toastManager } from "../ui/toast";

const RESET_OUTCOME_TEXT: Record<ProviderConsumeResetCreditOutcome, string> = {
  reset: "Reset applied. Your windows have cleared.",
  nothingToReset: "Nothing to reset right now.",
  noCredit: "No reset credit left.",
  alreadyRedeemed: "That credit was already redeemed.",
};

type LimitAccountGroup = {
  readonly driver: ProviderDriverKind;
  readonly label: string;
  readonly accounts: readonly LimitAccount[];
};

type ResetRequest = {
  readonly accountLabel: string;
  readonly environmentId: EnvironmentId;
  readonly input: ProviderConsumeResetCreditInput;
};

function accountLabel(account: LimitAccount): string {
  return (
    account.displayName ??
    account.email ??
    getDriverOption(account.driver)?.label ??
    String(account.driver)
  );
}

export function groupLimitAccounts(
  accounts: readonly LimitAccount[],
): readonly LimitAccountGroup[] {
  const order = new Map(DRIVER_OPTIONS.map((driver, index) => [driver.value, index]));
  const groups = new Map<ProviderDriverKind, LimitAccount[]>();
  for (const account of accounts) {
    const group = groups.get(account.driver);
    if (group) group.push(account);
    else groups.set(account.driver, [account]);
  }
  return [...groups]
    .map(([driver, members]) => ({
      driver,
      label: getDriverOption(driver)?.label ?? String(driver),
      accounts: members.toSorted(
        (left, right) =>
          accountLabel(left).localeCompare(accountLabel(right)) ||
          left.key.localeCompare(right.key),
      ),
    }))
    .toSorted(
      (left, right) =>
        (order.get(left.driver) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(right.driver) ?? Number.MAX_SAFE_INTEGER) ||
        left.label.localeCompare(right.label),
    );
}

function AccountIdentity({ account }: { readonly account: LimitAccount }) {
  const providerLabel = getDriverOption(account.driver)?.label ?? String(account.driver);
  const where =
    account.environments.length > 0
      ? account.environments.map((environment) => environment.label).join(", ")
      : account.sourceLabel;
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <ProviderInstanceIcon
        driverKind={account.driver}
        displayName={account.displayName ?? providerLabel}
        accentColor={account.accentColor}
        showBadge={Boolean(account.displayName)}
        indicatorBackground="var(--popover)"
        className="mt-0.5 size-5 shrink-0"
        iconClassName="size-4 text-foreground/80"
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span className="truncate font-medium text-foreground">
            {account.displayName ?? providerLabel}
          </span>
          {account.email ? (
            <RedactedSensitiveText
              value={account.email}
              ariaLabel="Toggle account email visibility"
              revealTooltip="Click to reveal email"
              hideTooltip="Click to hide email"
              className="max-w-52 truncate text-muted-foreground"
            />
          ) : null}
        </div>
        {account.plan || where ? (
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {[account.plan, where].filter(Boolean).join(" · ")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AccountLimits({
  account,
  now,
  onReset,
}: {
  readonly account: LimitAccount;
  readonly now: number;
  readonly onReset: (request: ResetRequest) => void;
}) {
  const credits = account.limits.resetCredits;
  const redeem = account.redeem;
  return (
    <div className="flex flex-col gap-2.5 border-b border-border/60 py-3 last:border-b-0">
      <AccountIdentity account={account} />
      <LimitWindows compact driver={account.driver} windows={account.limits.windows} now={now} />
      {credits && credits.availableCount > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1 tabular-nums">
            <TicketIcon className="size-3" aria-hidden />
            {resetCreditsSummary(credits, now, true)}
          </span>
          {credits.availableCount > 0 && redeem ? (
            <Button
              size="xs"
              variant="outline"
              className="ms-auto"
              onClick={() =>
                onReset({
                  accountLabel: accountLabel(account),
                  environmentId: redeem.environmentId,
                  input: redeem.input,
                })
              }
            >
              Use reset
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function HeaderUsageLimitsPopover({
  activeEnvironmentId,
  activeProviderInstanceId,
}: {
  readonly activeEnvironmentId: EnvironmentId | null;
  readonly activeProviderInstanceId: ProviderInstanceId | null;
}) {
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const consumeResetCredit = useAtomCommand(serverEnvironment.consumeResetCredit, {
    reportFailure: false,
  });
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [resetRequest, setResetRequest] = useState<ResetRequest | null>(null);
  const refreshingRef = useRef(false);
  const connectedPresentations = useMemo(
    () =>
      new Map(
        [...presentations].filter(
          ([, presentation]) =>
            presentation.connection.phase === "connected" && presentation.serverConfig !== null,
        ),
      ),
    [presentations],
  );
  const accounts = useMemo(
    () => collectLimitAccounts(connectedPresentations),
    [connectedPresentations],
  );
  const activeProvider =
    activeEnvironmentId && activeProviderInstanceId
      ? connectedPresentations
          .get(activeEnvironmentId)
          ?.serverConfig?.providers?.find(
            (provider) => provider.instanceId === activeProviderInstanceId,
          )
      : undefined;
  const activeEmail = activeProvider?.auth.email?.trim().toLowerCase();
  const activeAccount = activeProvider
    ? accounts.find((account) =>
        activeEmail
          ? account.driver === activeProvider.driver &&
            account.email?.trim().toLowerCase() === activeEmail
          : account.key === `${activeEnvironmentId}:${activeProvider.instanceId}`,
      )
    : undefined;
  const activeRemaining = activeAccount?.limits.windows.reduce<number | null>(
    (lowest, window) => Math.min(lowest ?? 100, remainingPercent(window)),
    null,
  );
  const triggerColor =
    activeRemaining === null || activeRemaining === undefined
      ? undefined
      : usageLimitBarColor("var(--foreground)", activeRemaining);
  const groups = useMemo(() => groupLimitAccounts(accounts), [accounts]);
  const notices = useMemo(
    () => collectLimitNotices(connectedPresentations),
    [connectedPresentations],
  );

  const refresh = async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await Promise.all(
        [...connectedPresentations].map(([environmentId]) => {
          return refreshUsageLimits(
            environmentId,
            () => refreshProviders({ environmentId, input: {} }),
            true,
          );
        }),
      );
    } finally {
      setNow(Date.now());
      refreshingRef.current = false;
      setRefreshing(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) return;
    setNow(Date.now());
    void refresh();
  };

  const requestReset = (request: ResetRequest) => {
    setOpen(false);
    setResetRequest(request);
  };

  const confirmReset = () => {
    const request = resetRequest;
    if (!request) return;
    setResetRequest(null);
    void consumeResetCredit({ environmentId: request.environmentId, input: request.input }).then(
      (result) => {
        if (result._tag === "Success") {
          const warning = result.value.warning;
          toastManager.add({
            type: warning ? "warning" : "success",
            title: warning ?? RESET_OUTCOME_TEXT[result.value.outcome],
            description: request.accountLabel,
          });
          setNow(Date.now());
          return;
        }
        if (isAtomCommandInterrupted(result)) return;
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not use reset credit",
          description: error instanceof Error ? error.message : request.accountLabel,
        });
      },
    );
  };

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <Button
                    size={
                      activeRemaining === null || activeRemaining === undefined ? "icon-xs" : "xs"
                    }
                    variant="outline"
                    aria-label={
                      activeRemaining === null || activeRemaining === undefined
                        ? "Usage limits"
                        : `Usage limits, ${activeRemaining}% remaining`
                    }
                    className="gap-1.5 tabular-nums"
                    style={triggerColor ? { color: triggerColor } : undefined}
                    data-toolbar-control=""
                  />
                }
              />
            }
          >
            <GaugeIcon className="size-4" aria-hidden />
            {activeRemaining === null || activeRemaining === undefined ? null : (
              <span>{activeRemaining}%</span>
            )}
          </TooltipTrigger>
          <TooltipPopup side="top">
            {activeRemaining === null || activeRemaining === undefined
              ? "Usage limits"
              : `Usage limits · ${activeRemaining}% remaining`}
          </TooltipPopup>
        </Tooltip>
        <PopoverPopup
          side="bottom"
          align="end"
          className="w-[min(30rem,calc(100vw-2rem))]"
          viewportClassName="max-h-[min(34rem,calc(100dvh-6rem))] p-0"
          aria-label="Usage limits"
        >
          <div className="flex flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
              <div className="min-w-0">
                <PopoverTitle className="text-sm leading-5">Usage limits</PopoverTitle>
                <p className="text-[11px] text-muted-foreground">
                  All accounts across connected environments
                </p>
              </div>
              <RefreshIcon
                className="size-3.5 shrink-0 text-muted-foreground"
                refreshing={refreshing}
              />
              {refreshing ? <span className="sr-only">Refreshing limits</span> : null}
            </div>
            <div className="px-4 py-1">
              {groups.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">
                  No connected provider reports subscription limits.
                </p>
              ) : (
                groups.map((group) => (
                  <section
                    key={group.driver}
                    className="border-b border-border/60 py-3 last:border-b-0"
                  >
                    <h3 className="flex items-center gap-2 text-xs font-medium text-foreground">
                      <ProviderInstanceIcon
                        driverKind={group.driver}
                        displayName={group.label}
                        indicatorBackground="var(--popover)"
                        className="size-4"
                        iconClassName="size-3.5 text-foreground/80"
                      />
                      {group.label}
                    </h3>
                    <div className="mt-1">
                      {group.accounts.map((account) => (
                        <AccountLimits
                          key={account.key}
                          account={account}
                          now={now}
                          onReset={requestReset}
                        />
                      ))}
                    </div>
                  </section>
                ))
              )}
              {notices.length > 0 ? (
                <div className="flex gap-2 border-t border-border/60 py-3 text-xs text-warning-foreground">
                  <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <div className="flex min-w-0 flex-col gap-1">
                    {notices.map((notice) => (
                      <span key={notice} className="break-words">
                        {notice}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </PopoverPopup>
      </Popover>
      <ResetCreditDialog
        open={resetRequest !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setResetRequest(null);
        }}
        onConfirm={confirmReset}
      />
    </>
  );
}
