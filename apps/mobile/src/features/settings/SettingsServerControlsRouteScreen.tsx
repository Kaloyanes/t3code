import { ScreenScrollView as ScrollView } from "../../components/ScreenScrollView";
import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text, AppTextInput } from "../../components/AppText";
import {
  DEFAULT_PROMPT_ENHANCEMENT_SYSTEM_PROMPT,
  type ModelSelection,
  type ResponseStreamingMode,
  type ServerSettings,
  type ServerSettingsPatch,
  type ThreadEnvMode,
  PROJECT_SCOPED_SERVER_SETTING_KEYS,
  type ProjectScopedServerSettingKey,
} from "@t3tools/contracts";
import { getProviderOptionCurrentValue } from "@t3tools/shared/model";
import { useRef, useState, type ComponentProps } from "react";
import { Alert, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RUNTIME_MODE_CHOICES } from "../threads/thread-settings-options";
import { selectableChoices } from "../threads/thread-settings-options";
import {
  applyProviderOptionSelection,
  resolveProviderOptionDescriptors,
} from "../../lib/providerOptions";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsScreen } from "./components/SettingsScreen";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsControlRow } from "./components/SettingsControlRow";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { SettingsProjectOverridesSection } from "./components/SettingsProjectOverridesSection";
import { useSettingsEnvironmentFilter } from "./settings-environment-filter";
import {
  planMobileScopedSettingsClear,
  planMobileScopedSettingsPatch,
  resolveMobileSettingsTargets,
  type ScopedMobileSettingsTarget,
} from "./settings-scoped-server";

type SettingsPage = "new-threads" | "source-control" | "agent-behavior" | "maintenance";

const PAGE_TITLES: Record<SettingsPage, string> = {
  "new-threads": "New threads",
  "source-control": "Source control",
  "agent-behavior": "Agent behavior",
  maintenance: "Maintenance",
};

const PAGE_PROJECT_KEYS: Record<SettingsPage, readonly ProjectScopedServerSettingKey[]> = {
  "new-threads": [
    "defaultThreadEnvMode",
    "defaultRuntimeMode",
    "promptEnhancementModelSelection",
    "promptEnhancementSystemPrompt",
  ],
  "source-control": [
    "defaultAutoPull",
    "newWorktreesStartFromOrigin",
    "completeLinkedIssueOnMerge",
  ],
  "agent-behavior": ["responseStreamingMode", "enableAgentBrowserAccess"],
  maintenance: ["continueThreadsAfterServerUpdate"],
};

const WORKSPACE_CHOICES: ReadonlyArray<{
  readonly mode: ThreadEnvMode;
  readonly label: string;
  readonly description: string;
}> = [
  {
    mode: "local",
    label: "Current checkout",
    description: "Start new threads in the existing workspace.",
  },
  {
    mode: "worktree",
    label: "New worktree",
    description: "Give each new thread a separate checkout.",
  },
];

const STREAMING_CHOICES: ReadonlyArray<{
  readonly mode: ResponseStreamingMode;
  readonly label: string;
  readonly description: string;
}> = [
  {
    mode: "turn",
    label: "After the turn",
    description: "Show the answer when the agent finishes.",
  },
  {
    mode: "paragraph",
    label: "Finished paragraphs",
    description: "Show each paragraph or code block as it completes.",
  },
  {
    mode: "token",
    label: "Token by token (legacy)",
    description: "Repaint for every token; this can be slower.",
  },
];

export function SettingsEnvironmentNewThreadsRouteScreen() {
  return <ServerSettingsDetail page="new-threads" />;
}

export function SettingsEnvironmentSourceControlRouteScreen() {
  return <ServerSettingsDetail page="source-control" />;
}

export function SettingsEnvironmentAgentBehaviorRouteScreen() {
  return <ServerSettingsDetail page="agent-behavior" />;
}

export function SettingsEnvironmentMaintenanceRouteScreen() {
  return <ServerSettingsDetail page="maintenance" />;
}

function ServerSettingsDetail(props: { readonly page: SettingsPage }) {
  const insets = useSafeAreaInsets();
  const { selectedTargets, projectGroups, selectedProjectKey } = useSettingsEnvironmentFilter();
  const selectedProject = projectGroups.find((group) => group.key === selectedProjectKey);
  const projectSelected = selectedProjectKey !== null;
  const targets = resolveMobileSettingsTargets(
    selectedTargets,
    projectSelected ? (selectedProject?.members.map((member) => member.project) ?? []) : null,
  );
  const [pendingWrites, setPendingWrites] = useState(0);
  const writeInFlight = useRef(false);
  const [pendingTargets, setPendingTargets] = useState<
    readonly ScopedMobileSettingsTarget[] | null
  >(null);
  const displayTargets = pendingWrites > 0 && pendingTargets !== null ? pendingTargets : targets;
  const hasConnectedSelection = targets.length > 0;
  const reference = displayTargets[0] ?? null;
  const uniform = <K extends keyof ServerSettings>(key: K): ServerSettings[K] | null => {
    if (reference === null) return null;
    const value = reference.settings[key];
    return displayTargets.every((entry) => entry.settings[key] === value) ? value : null;
  };
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "environment settings update",
    reportFailure: true,
  });
  const write = (patch: ServerSettingsPatch) => {
    if (writeInFlight.current || !hasConnectedSelection) return;
    const writes = planMobileScopedSettingsPatch(targets, projectSelected, patch);
    if (writes.length === 0) return;
    writeInFlight.current = true;
    setPendingTargets(targets);
    setPendingWrites((count) => count + 1);
    void Promise.allSettled(
      writes.map((entry) =>
        updateSettings({ environmentId: entry.environmentId, input: { patch: entry.patch } }),
      ),
    ).finally(() => {
      writeInFlight.current = false;
      setPendingTargets(null);
      setPendingWrites((count) => count - 1);
    });
  };
  const clearProjectOverrides = () => {
    if (writeInFlight.current) return;
    const writes = planMobileScopedSettingsClear(targets, PAGE_PROJECT_KEYS[props.page]);
    if (writes.length === 0) return;
    writeInFlight.current = true;
    setPendingTargets(targets);
    setPendingWrites((count) => count + 1);
    void Promise.allSettled(
      writes.map((entry) =>
        updateSettings({ environmentId: entry.environmentId, input: { patch: entry.patch } }),
      ),
    ).finally(() => {
      writeInFlight.current = false;
      setPendingTargets(null);
      setPendingWrites((count) => count - 1);
    });
  };
  const supportsProjectOverrides = targets.every(
    (target) =>
      target.environment.serverConfig.environment.capabilities.projectSettingsOverrides === true,
  );
  const disabled =
    pendingWrites > 0 || !hasConnectedSelection || (projectSelected && !supportsProjectOverrides);
  const supportsContinuation = targets.every(
    (target) =>
      target.environment.serverConfig.environment.capabilities.threadRestartContinuation === true,
  );
  const supportsIssueCompletion = targets.every(
    (target) =>
      target.environment.serverConfig.environment.capabilities.issueCompletionOnMerge === true,
  );
  const disabledFor = (key: string) =>
    disabled ||
    (projectSelected &&
      !PROJECT_SCOPED_SERVER_SETTING_KEYS.includes(
        key as (typeof PROJECT_SCOPED_SERVER_SETTING_KEYS)[number],
      ));
  const promptSetting = uniform("promptEnhancementModelSelection");
  const promptModelSelection: ModelSelection | null =
    promptSetting ?? reference?.settings.textGenerationModelSelection ?? null;
  const promptProviders =
    reference?.environment.serverConfig?.providers.filter(
      (provider) =>
        provider.enabled && provider.installed && provider.supportsTextGeneration !== false,
    ) ?? [];
  const promptModel = promptProviders
    .find((provider) => provider.instanceId === promptModelSelection?.instanceId)
    ?.models.find((model) => model.slug === promptModelSelection?.model);
  const promptDescriptors = resolveProviderOptionDescriptors({
    capabilities: promptModel?.capabilities,
    selections: promptModelSelection?.options,
  }).filter((descriptor) => descriptor.type === "select");
  const supportsPromptEnhancement = targets.every(
    (target) =>
      target.environment.serverConfig?.environment.capabilities.promptEnhancement === true,
  );
  const promptSystemPromptMixed =
    reference !== null &&
    displayTargets.some(
      (target) =>
        target.settings.promptEnhancementSystemPrompt !==
        reference.settings.promptEnhancementSystemPrompt,
    );
  const promptSystemPrompt = promptSystemPromptMixed
    ? ""
    : (reference?.settings.promptEnhancementSystemPrompt ??
      DEFAULT_PROMPT_ENHANCEMENT_SYSTEM_PROMPT);

  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen
        title={PAGE_TITLES[props.page]}
        trailing={<AndroidSettingsEnvironmentFilter />}
      >
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          className="flex-1"
          contentContainerClassName="gap-6 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {!hasConnectedSelection || reference === null ? (
            <Text className="px-2 text-base text-foreground-muted">
              {projectSelected
                ? "Select a project with a checkout on a connected environment."
                : "Use the filter above to select a connected environment."}
            </Text>
          ) : (
            <>
              {projectSelected ? (
                <SettingsProjectOverridesSection
                  projectLabel={selectedProject?.label ?? "Unavailable project"}
                  hasOverrides={targets.some((target) =>
                    PAGE_PROJECT_KEYS[props.page].some((key) => target.sources[key] === "project"),
                  )}
                  supportsOverrides={supportsProjectOverrides}
                  pending={pendingWrites > 0}
                  onClear={clearProjectOverrides}
                />
              ) : null}
              {props.page === "new-threads" ? (
                <>
                  <SettingsSection
                    title="Default workspace"
                    trailing={
                      pendingWrites === 0 && uniform("defaultThreadEnvMode") === null ? (
                        <MixedValuesLabel projectSelected={projectSelected} />
                      ) : null
                    }
                  >
                    {WORKSPACE_CHOICES.map((choice, index) => (
                      <ChoiceRow
                        key={choice.mode}
                        label={choice.label}
                        description={choice.description}
                        selected={uniform("defaultThreadEnvMode") === choice.mode}
                        separated={index > 0}
                        disabled={disabledFor("defaultThreadEnvMode")}
                        onPress={() => write({ defaultThreadEnvMode: choice.mode })}
                      />
                    ))}
                  </SettingsSection>
                  <SettingsSection
                    title="Default permissions"
                    trailing={
                      pendingWrites === 0 && uniform("defaultRuntimeMode") === null ? (
                        <MixedValuesLabel projectSelected={projectSelected} />
                      ) : null
                    }
                  >
                    {RUNTIME_MODE_CHOICES.map((choice, index) => (
                      <ChoiceRow
                        key={choice.mode}
                        label={choice.label}
                        description={choice.description}
                        selected={uniform("defaultRuntimeMode") === choice.mode}
                        separated={index > 0}
                        disabled={disabledFor("defaultRuntimeMode")}
                        onPress={() => write({ defaultRuntimeMode: choice.mode })}
                      />
                    ))}
                  </SettingsSection>
                  <SettingsSection title="Prompt enhancement model">
                    <ChoiceRow
                      label="Use text generation model"
                      description="Follow the model selected for generated text."
                      selected={promptSetting === null}
                      separated={false}
                      disabled={
                        disabledFor("promptEnhancementModelSelection") || !supportsPromptEnhancement
                      }
                      onPress={() => write({ promptEnhancementModelSelection: null })}
                    />
                    {promptProviders.flatMap((provider) =>
                      provider.models
                        .filter((model) => !model.isLegacy)
                        .map((model) => (
                          <ChoiceRow
                            key={`${provider.instanceId}:${model.slug}`}
                            label={model.name}
                            description={provider.displayName ?? provider.driver}
                            selected={
                              promptSetting !== null &&
                              promptSetting?.instanceId === provider.instanceId &&
                              promptSetting.model === model.slug
                            }
                            separated
                            disabled={
                              disabledFor("promptEnhancementModelSelection") ||
                              !supportsPromptEnhancement
                            }
                            onPress={() =>
                              write({
                                promptEnhancementModelSelection: {
                                  instanceId: provider.instanceId,
                                  model: model.slug,
                                },
                              })
                            }
                          />
                        )),
                    )}
                  </SettingsSection>
                  <PromptEnhancementSystemPromptSection
                    key={promptSystemPromptMixed ? "mixed" : promptSystemPrompt}
                    value={promptSystemPrompt}
                    mixed={promptSystemPromptMixed}
                    projectSelected={projectSelected}
                    customized={
                      promptSystemPromptMixed ||
                      reference.settings.promptEnhancementSystemPrompt !== null
                    }
                    disabled={
                      disabledFor("promptEnhancementSystemPrompt") || !supportsPromptEnhancement
                    }
                    onSave={(promptEnhancementSystemPrompt) =>
                      write({ promptEnhancementSystemPrompt })
                    }
                    onReset={() => write({ promptEnhancementSystemPrompt: null })}
                  />
                  {promptSetting !== null && promptDescriptors.length > 0 ? (
                    <SettingsSection title="Prompt enhancement effort">
                      {promptDescriptors.flatMap((descriptor) =>
                        descriptor.type === "select"
                          ? selectableChoices(descriptor).map((choice, index) => (
                              <ChoiceRow
                                key={`${descriptor.id}:${choice.id}`}
                                label={choice.label}
                                description={descriptor.label}
                                selected={choice.id === getProviderOptionCurrentValue(descriptor)}
                                separated={index > 0}
                                disabled={disabledFor("promptEnhancementModelSelection")}
                                onPress={() => {
                                  if (!promptModelSelection) return;
                                  const options = applyProviderOptionSelection(promptDescriptors, {
                                    id: descriptor.id,
                                    value: choice.id,
                                  });
                                  if (!options) return;
                                  write({
                                    promptEnhancementModelSelection: {
                                      ...promptModelSelection,
                                      options,
                                    },
                                  });
                                }}
                              />
                            ))
                          : [],
                      )}
                    </SettingsSection>
                  ) : null}
                </>
              ) : null}

              {props.page === "source-control" ? (
                <>
                  <SettingsSection title="Default branch">
                    <FanoutSwitchRow
                      icon="arrow.down.circle"
                      label="Automatically pull"
                      subtitle="Keep the default branch current when there are no local changes."
                      value={uniform("defaultAutoPull")}
                      disabled={disabledFor("defaultAutoPull")}
                      onValueChange={(value) => write({ defaultAutoPull: value })}
                    />
                  </SettingsSection>
                  <SettingsSection title="Worktrees">
                    <FanoutSwitchRow
                      icon="arrow.triangle.branch"
                      label="Start from origin"
                      subtitle="Base new worktrees on the remote branch."
                      value={uniform("newWorktreesStartFromOrigin")}
                      disabled={disabledFor("newWorktreesStartFromOrigin")}
                      onValueChange={(value) => write({ newWorktreesStartFromOrigin: value })}
                    />
                    <ChoiceRow
                      label="Conventional branch prefixes"
                      description="Use feature/, bug/, issue/, or maintenance/ based on the work."
                      selected={uniform("worktreeBranchNamingMode") === "conventional"}
                      separated
                      disabled={disabledFor("worktreeBranchNamingMode")}
                      onPress={() => write({ worktreeBranchNamingMode: "conventional" })}
                    />
                    <ChoiceRow
                      label="T3 Code branch prefix"
                      description="Keep using the configured T3 Code prefix for generated branches."
                      selected={uniform("worktreeBranchNamingMode") === "prefix"}
                      separated
                      disabled={disabledFor("worktreeBranchNamingMode")}
                      onPress={() => write({ worktreeBranchNamingMode: "prefix" })}
                    />
                  </SettingsSection>
                  {supportsIssueCompletion ? (
                    <SettingsSection title="Automation">
                      <FanoutSwitchRow
                        icon="checkmark.circle"
                        label="Complete linked issue on merge"
                        subtitle="Mark the linked issue completed once every pull request for its worktree has merged."
                        value={uniform("completeLinkedIssueOnMerge")}
                        disabled={disabledFor("completeLinkedIssueOnMerge")}
                        onValueChange={(value) => write({ completeLinkedIssueOnMerge: value })}
                      />
                    </SettingsSection>
                  ) : null}
                </>
              ) : null}

              {props.page === "agent-behavior" ? (
                <>
                  <SettingsSection
                    title="Response streaming"
                    trailing={
                      pendingWrites === 0 && uniform("responseStreamingMode") === null ? (
                        <MixedValuesLabel projectSelected={projectSelected} />
                      ) : null
                    }
                  >
                    {STREAMING_CHOICES.map((choice, index) => (
                      <ChoiceRow
                        key={choice.mode}
                        label={choice.label}
                        description={choice.description}
                        selected={uniform("responseStreamingMode") === choice.mode}
                        separated={index > 0}
                        disabled={disabledFor("responseStreamingMode")}
                        onPress={() => {
                          if (choice.mode !== "token") {
                            write({ responseStreamingMode: choice.mode });
                            return;
                          }
                          Alert.alert(
                            "Use legacy token streaming?",
                            "Repainting every token can make the app slower.",
                            [
                              { text: "Cancel", style: "cancel" },
                              {
                                text: "Use token streaming",
                                onPress: () => write({ responseStreamingMode: "token" }),
                              },
                            ],
                          );
                        }}
                      />
                    ))}
                  </SettingsSection>
                  <SettingsSection title="Preview browser">
                    <FanoutSwitchRow
                      icon="globe"
                      label="Agent browser access"
                      subtitle="Allow agents to use the in-app preview browser."
                      value={uniform("enableAgentBrowserAccess")}
                      disabled={disabledFor("enableAgentBrowserAccess")}
                      onValueChange={(value) => write({ enableAgentBrowserAccess: value })}
                    />
                  </SettingsSection>
                </>
              ) : null}

              {props.page === "maintenance" ? (
                <SettingsSection title="Updates">
                  <FanoutSwitchRow
                    icon="arrow.clockwise"
                    label="Check provider updates"
                    subtitle={
                      projectSelected
                        ? "Environment-wide setting. Select All projects to change it."
                        : "Check installed provider CLIs for newer versions."
                    }
                    value={uniform("enableProviderUpdateChecks")}
                    disabled={disabledFor("enableProviderUpdateChecks")}
                    onValueChange={(value) => write({ enableProviderUpdateChecks: value })}
                  />
                  <View className="border-t border-border-subtle">
                    <FanoutSwitchRow
                      icon="arrow.uturn.forward"
                      label="Continue after restart"
                      subtitle={
                        supportsContinuation
                          ? "Resume interrupted threads after an update or restart."
                          : "Update older servers to control restart continuation."
                      }
                      value={uniform("continueThreadsAfterServerUpdate")}
                      disabled={
                        disabledFor("continueThreadsAfterServerUpdate") || !supportsContinuation
                      }
                      onValueChange={(value) => write({ continueThreadsAfterServerUpdate: value })}
                    />
                  </View>
                </SettingsSection>
              ) : null}
            </>
          )}
        </ScrollView>
      </SettingsScreen>
    </>
  );
}

function PromptEnhancementSystemPromptSection(props: {
  readonly value: string;
  readonly mixed: boolean;
  readonly projectSelected: boolean;
  readonly customized: boolean;
  readonly disabled: boolean;
  readonly onSave: (value: string) => void;
  readonly onReset: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(props.mixed ? null : props.value);
  const canSave = props.mixed ? draft !== null : draft !== props.value;

  return (
    <SettingsSection
      title="Prompt enhancement system prompt"
      trailing={props.mixed ? <MixedValuesLabel projectSelected={props.projectSelected} /> : null}
    >
      <View className="gap-3 p-4">
        <Text className="text-sm leading-normal text-foreground-muted">
          Instructions used to compile prompt-enhancement requests.
        </Text>
        <AppTextInput
          accessibilityLabel="Prompt enhancement system prompt"
          className="h-80 rounded-xl px-3 py-3 text-sm"
          value={draft ?? ""}
          placeholder={props.mixed ? "Enter a prompt to apply it to all." : undefined}
          multiline
          scrollEnabled
          textAlignVertical="top"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!props.disabled}
          onChangeText={setDraft}
        />
        <View className="flex-row justify-end gap-2">
          {props.customized ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reset prompt enhancement system prompt to default"
              disabled={props.disabled}
              className="rounded-full bg-subtle px-4 py-2 active:opacity-70 disabled:opacity-[0.45]"
              onPress={props.onReset}
            >
              <Text className="text-sm font-t3-medium text-foreground">Reset</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save prompt enhancement system prompt"
            accessibilityState={{ disabled: props.disabled || !canSave }}
            disabled={props.disabled || !canSave}
            className="rounded-full bg-subtle-strong px-4 py-2 active:opacity-70 disabled:opacity-[0.45]"
            onPress={() => {
              if (draft !== null) props.onSave(draft);
            }}
          >
            <Text className="text-sm font-t3-medium text-foreground">Save</Text>
          </Pressable>
        </View>
      </View>
    </SettingsSection>
  );
}

function ChoiceRow(props: {
  readonly label: string;
  readonly description: string;
  readonly selected: boolean;
  readonly separated: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected, disabled: props.disabled }}
      className={
        props.separated
          ? "flex-row items-center gap-4 border-t border-border-subtle p-4 active:opacity-70"
          : "flex-row items-center gap-4 p-4 active:opacity-70"
      }
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <View className="min-w-0 flex-1 gap-1">
        <Text
          className={
            Platform.OS === "android" ? "text-base text-foreground" : "text-lg text-foreground"
          }
        >
          {props.label}
        </Text>
        <Text className="text-sm leading-normal text-foreground-muted">{props.description}</Text>
      </View>
      {props.selected ? (
        <SymbolView
          name="checkmark"
          size={18}
          tintColorClassName="accent-icon"
          type="monochrome"
          weight="semibold"
        />
      ) : null}
    </Pressable>
  );
}

function MixedValuesLabel(props: { readonly projectSelected: boolean }) {
  return (
    <Text
      accessibilityLabel={
        props.projectSelected
          ? "Selected project checkouts use different values"
          : "Selected environments use different values"
      }
      className="px-2 text-sm text-foreground-muted android:px-4"
    >
      Mixed
    </Text>
  );
}

function FanoutSwitchRow(props: {
  readonly icon: ComponentProps<typeof SymbolView>["name"];
  readonly label: string;
  readonly subtitle: string;
  readonly value: boolean | null;
  readonly disabled: boolean;
  readonly onValueChange: (value: boolean) => void;
}) {
  if (props.value !== null) {
    return (
      <SettingsSwitchRow
        icon={props.icon}
        label={props.label}
        subtitle={props.subtitle}
        value={props.value}
        disabled={props.disabled}
        onValueChange={props.onValueChange}
      />
    );
  }

  return (
    <SettingsControlRow
      disabled={props.disabled}
      icon={props.icon}
      label={props.label}
      subtitle={props.subtitle}
    >
      <Pressable
        accessibilityLabel={`Set ${props.label} on for selected environments`}
        accessibilityRole="button"
        disabled={props.disabled}
        className="rounded-full bg-subtle px-3 py-2 active:opacity-70"
        onPress={() => props.onValueChange(true)}
      >
        <Text className="text-sm font-t3-medium text-foreground">Mixed · Set on</Text>
      </Pressable>
    </SettingsControlRow>
  );
}
