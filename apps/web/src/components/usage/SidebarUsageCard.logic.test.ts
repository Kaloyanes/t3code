import {
  EnvironmentId,
  ThreadId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { collectLimitAccounts } from "@t3tools/shared/usageLimits";
import { describe, expect, it } from "vite-plus/test";
import { makeThreadFixture } from "../../test-fixtures";
import { DraftId } from "../../composerDraftStore";
import {
  activeAccountRemaining,
  sidebarComposerProvider,
  sidebarUsageThreadRef,
} from "./SidebarUsageCard.logic";

const environmentId = EnvironmentId.make("environment");
const checkedAt = "2026-09-18T10:00:00.000Z";
function provider(instance: string, overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instance),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt,
      windows: [
        {
          id: "session",
          kind: "session",
          label: "Session",
          usedPercent: 20,
          windowDurationMins: 300,
        },
        {
          id: "weekly",
          kind: "weekly",
          label: "Weekly",
          usedPercent: 80,
          windowDurationMins: 10080,
        },
      ],
    },
    ...overrides,
  };
}
function accounts(providers: readonly ServerProvider[]) {
  return collectLimitAccounts(
    new Map([
      [environmentId, { entry: { target: { label: "Environment" } }, serverConfig: { providers } }],
    ]),
  );
}
const baseSelection = {
  settings: { providerInstances: {} },
  thread: null,
  composerProvider: null,
  defaultModel: undefined,
};

describe("collapsed sidebar usage", () => {
  it("shows the selected account for a remote draft before its first message", () => {
    const remoteId = EnvironmentId.make("remote");
    const active = provider("remote-provider");
    const threadRef = sidebarUsageThreadRef(
      { kind: "draft", draftId: DraftId.make("new-thread") },
      { environmentId: remoteId, threadId: ThreadId.make("draft-thread") },
    );
    const selected = sidebarComposerProvider({
      ...baseSelection,
      providers: [active],
      settings: {
        providerInstances: {
          [active.instanceId]: { driver: active.driver, enabled: true },
        },
      },
      composerProvider: active.instanceId,
    });
    const collected = collectLimitAccounts(
      new Map([
        [
          remoteId,
          { entry: { target: { label: "Remote" } }, serverConfig: { providers: [active] } },
        ],
      ]),
    );
    expect(threadRef?.environmentId).toBe(remoteId);
    expect(
      activeAccountRemaining(
        collected,
        threadRef?.environmentId ?? null,
        selected,
        "shortest-window",
      ),
    ).toBe(80);
  });

  it("selects the active account's lowest or shortest window rather than the pooled percent", () => {
    const active = provider("active");
    const others = provider("other", {
      usageLimits: {
        checkedAt,
        windows: [{ id: "session", kind: "session", label: "Session", usedPercent: 0 }],
      },
    });
    const collected = accounts([active, others]);
    expect(activeAccountRemaining(collected, environmentId, active, "lowest-percentage")).toBe(20);
    expect(activeAccountRemaining(collected, environmentId, active, "shortest-window")).toBe(80);
  });

  it("matches normalized email across environments and driver boundaries", () => {
    const active = provider("active", {
      auth: { status: "authenticated", email: " Person@Example.com " },
    });
    const collected = accounts([
      provider("other", { auth: { status: "authenticated", email: "person@example.com" } }),
      provider("claude", {
        driver: ProviderDriverKind.make("claudeAgent"),
        auth: { status: "authenticated", email: "person@example.com" },
        usageLimits: {
          checkedAt,
          windows: [{ id: "session", kind: "session", label: "Session", usedPercent: 99 }],
        },
      }),
    ]);
    expect(
      activeAccountRemaining(collected, EnvironmentId.make("remote"), active, "shortest-window"),
    ).toBe(80);
  });

  it("matches credential identity when a deduplicated account has no email", () => {
    const active = provider("active", {
      usageLimits: {
        checkedAt,
        credentialFingerprint: "same-login",
        windows: [{ id: "session", kind: "session", label: "Session", usedPercent: 60 }],
      },
    });
    const collected = accounts([
      active,
      { ...active, instanceId: ProviderInstanceId.make("duplicate") },
    ]);
    expect(collected).toHaveLength(1);
    expect(
      activeAccountRemaining(collected, EnvironmentId.make("remote"), active, "lowest-percentage"),
    ).toBe(40);
  });

  it("keeps missing selection and windows unknown", () => {
    expect(
      activeAccountRemaining([], environmentId, provider("active"), "lowest-percentage"),
    ).toBeNull();
    const active = provider("active", { usageLimits: { checkedAt, windows: [] } });
    expect(
      activeAccountRemaining(accounts([active]), environmentId, active, "shortest-window"),
    ).toBeNull();
    expect(
      activeAccountRemaining(accounts([active]), environmentId, undefined, "shortest-window"),
    ).toBeNull();
  });

  it("honors composer overrides, then runtime, model and project default", () => {
    const override = provider("override");
    const runtime = provider("runtime");
    const model = provider("model");
    const project = provider("project");
    const providers = [override, runtime, model, project];
    const thread = makeThreadFixture({
      modelSelection: { instanceId: model.instanceId, model: "default" },
      runtime: {
        status: "running",
        activeRunId: null,
        providerInstanceId: runtime.instanceId,
        providerName: "codex",
        lastError: null,
        updatedAt: checkedAt,
      },
    });
    const input = {
      ...baseSelection,
      settings: {
        providerInstances: Object.fromEntries(
          providers.map((provider) => [
            provider.instanceId,
            { driver: provider.driver, enabled: provider.enabled },
          ]),
        ),
      },
      providers,
      thread,
      defaultModel: { instanceId: project.instanceId, model: "default" },
    };
    expect(
      sidebarComposerProvider({ ...input, composerProvider: override.instanceId })?.instanceId,
    ).toBe(override.instanceId);
    expect(sidebarComposerProvider(input)?.instanceId).toBe(runtime.instanceId);
    expect(
      sidebarComposerProvider({ ...input, thread: { ...thread, runtime: null } })?.instanceId,
    ).toBe(model.instanceId);
    expect(sidebarComposerProvider({ ...input, thread: null })?.instanceId).toBe(
      project.instanceId,
    );
  });

  it("locks to the shell runtime instance's driver when its name is omitted", () => {
    const runtime = provider("claude", { driver: ProviderDriverKind.make("claudeAgent") });
    const model = provider("codex");
    const thread = makeThreadFixture({
      itemCount: 1,
      modelSelection: { instanceId: model.instanceId, model: "default" },
      runtime: {
        status: "running",
        activeRunId: null,
        providerInstanceId: runtime.instanceId,
        providerName: null,
        lastError: null,
        updatedAt: checkedAt,
      },
    });
    expect(
      sidebarComposerProvider({
        ...baseSelection,
        providers: [model, runtime],
        settings: {
          providerInstances: {
            [runtime.instanceId]: { driver: runtime.driver, enabled: true },
            [model.instanceId]: { driver: model.driver, enabled: true },
          },
        },
        thread,
        composerProvider: model.instanceId,
      })?.instanceId,
    ).toBe(runtime.instanceId);
  });

  it("falls back from disabled overrides without crossing a started thread's provider lock", () => {
    const locked = provider("locked");
    const disabled = provider("disabled", { enabled: false });
    const claude = provider("claude", { driver: ProviderDriverKind.make("claudeAgent") });
    const thread = makeThreadFixture({
      modelSelection: { instanceId: locked.instanceId, model: "default" },
      itemCount: 1,
    });
    const input = {
      ...baseSelection,
      settings: {
        providerInstances: Object.fromEntries(
          [claude, disabled, locked].map((provider) => [
            provider.instanceId,
            { driver: provider.driver, enabled: provider.enabled },
          ]),
        ),
      },
      providers: [claude, disabled, locked],
      thread,
      composerProvider: disabled.instanceId,
    };
    expect(sidebarComposerProvider(input)?.instanceId).toBe(locked.instanceId);
    expect(
      sidebarComposerProvider({ ...input, composerProvider: claude.instanceId })?.instanceId,
    ).toBe(locked.instanceId);
    expect(sidebarComposerProvider({ ...input, providers: [claude] })).toBeUndefined();
  });
});
