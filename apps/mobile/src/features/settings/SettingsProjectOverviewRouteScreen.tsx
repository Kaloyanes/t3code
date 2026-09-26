import { ScreenScrollView as ScrollView } from "../../components/ScreenScrollView";
import { AppText as Text, AppTextInput } from "../../components/AppText";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import {
  derivePhysicalProjectKey,
  derivePhysicalProjectKeyFromPath,
  deriveProjectGroupLabel,
} from "@t3tools/client-runtime/state/project-grouping";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { resolveProjectWorktreeOptions } from "@t3tools/shared/git";
import { useMemo, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { vcsEnvironment } from "../../state/vcs";
import { SymbolView } from "../../components/AppSymbol";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { useSettingsEnvironmentFilter, type SettingsTarget } from "./settings-environment-filter";

export function SettingsProjectOverviewRouteScreen() {
  const insets = useSafeAreaInsets();
  const { selectedTargets, projectGroups, selectedProjectKey } = useSettingsEnvironmentFilter();
  const group = projectGroups.find((entry) => entry.key === selectedProjectKey);
  const selectedEnvironmentIds = new Set(selectedTargets.map((entry) => entry.environmentId));
  const members =
    group?.members
      .map((entry) => entry.project)
      .filter((project) => selectedEnvironmentIds.has(project.environmentId)) ?? [];

  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen title="Project overview" trailing={<AndroidSettingsEnvironmentFilter />}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          className="flex-1"
          contentContainerClassName="gap-6 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {members.length === 0 ? (
            <Text className="px-2 text-base text-foreground-muted">
              This project has no checkout on the selected connected environments. Change the filter
              above.
            </Text>
          ) : (
            <ProjectOverviewContent
              key={`${selectedProjectKey}:${members.map((member) => member.id).join(",")}`}
              members={members}
              environments={selectedTargets}
            />
          )}
        </ScrollView>
      </SettingsScreen>
    </>
  );
}

function ProjectOverviewContent(props: {
  readonly members: readonly EnvironmentProject[];
  readonly environments: readonly SettingsTarget[];
}) {
  const representative = props.members[0]!;
  const displayName = deriveProjectGroupLabel({ representative, members: props.members });
  const [draftName, setDraftName] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const updateProject = useAtomCommand(projectEnvironment.update, {
    label: "project name update",
    reportFailure: true,
  });
  const nextName = (draftName ?? displayName).trim();
  const canSave = !isSaving && nextName.length > 0 && nextName !== displayName;

  const saveName = () => {
    if (!canSave) return;
    setIsSaving(true);
    void (async () => {
      try {
        const results = await Promise.all(
          props.members.map((member) =>
            updateProject({
              environmentId: member.environmentId,
              input: { projectId: member.id, title: nextName },
            }),
          ),
        );
        if (results.every((result) => result._tag !== "Failure")) setDraftName(null);
      } finally {
        setIsSaving(false);
      }
    })();
  };

  return (
    <>
      <View className="flex-row items-center gap-4 px-2">
        <ProjectFavicon
          environmentId={representative.environmentId}
          projectTitle={representative.title}
          workspaceRoot={representative.workspaceRoot}
          faviconPath={representative.faviconPath}
          projectIcon={representative.projectIcon}
          size={48}
        />
        <View className="min-w-0 flex-1">
          <Text className="text-xl font-t3-semibold text-foreground" numberOfLines={2}>
            {displayName}
          </Text>
          <Text className="text-sm text-foreground-muted">
            {props.members.length === 1 ? "1 checkout" : `${props.members.length} checkouts`}
          </Text>
        </View>
      </View>

      <SettingsSection title="Project">
        <View className="gap-3 p-4">
          <Text className="text-sm font-t3-medium text-foreground-muted">Name</Text>
          <View className="flex-row items-center gap-3">
            <AppTextInput
              accessibilityLabel="Project name"
              className="min-h-11 min-w-0 flex-1 rounded-xl border-continuous bg-card px-3 text-base text-foreground"
              value={draftName ?? displayName}
              onChangeText={setDraftName}
              onSubmitEditing={saveName}
              returnKeyType="done"
              editable={!isSaving}
            />
            {canSave ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save project name"
                onPress={saveName}
                className="rounded-full bg-subtle-strong px-4 py-2 active:opacity-70"
              >
                <Text className="text-sm font-t3-medium text-foreground">Save</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </SettingsSection>

      <SettingsSection title="Checkouts">
        {props.members.map((member, index) => {
          const environment = props.environments.find(
            (entry) => entry.environmentId === member.environmentId,
          );
          return (
            <View
              key={`${member.environmentId}:${member.id}`}
              className={index === 0 ? "gap-1 p-4" : "gap-1 border-t border-border-subtle p-4"}
            >
              <Text
                className={
                  Platform.OS === "android"
                    ? "text-base text-foreground"
                    : "text-lg text-foreground"
                }
              >
                {environment?.label ?? "Environment"}
              </Text>
              {environment?.displayUrl ? (
                <Text className="text-sm leading-normal text-foreground-muted">
                  {environment.displayUrl}
                </Text>
              ) : null}
              <Text className="text-sm leading-normal text-foreground-muted" selectable>
                {member.workspaceRoot}
              </Text>
            </View>
          );
        })}
      </SettingsSection>
      <SettingsSection title="Main worktree">
        {props.members.map((member, index) => (
          <MainWorktreeChoices
            key={`${member.environmentId}:${member.id}`}
            member={member}
            label={
              props.members.length > 1
                ? (props.environments.find((entry) => entry.environmentId === member.environmentId)
                    ?.label ?? "Environment")
                : null
            }
            divider={index > 0}
          />
        ))}
      </SettingsSection>
    </>
  );
}

function MainWorktreeChoices(props: {
  readonly member: EnvironmentProject;
  readonly label: string | null;
  readonly divider: boolean;
}) {
  const { selectedProjectKey, selectProject } = useSettingsEnvironmentFilter();
  const [saving, setSaving] = useState(false);
  const updateProject = useAtomCommand(projectEnvironment.update, {
    label: "main worktree update",
    reportFailure: true,
  });
  const refsAtom = useMemo(
    () =>
      vcsEnvironment.listRefs({
        environmentId: props.member.environmentId,
        input: { cwd: props.member.workspaceRoot, refKind: "local", worktreesOnly: true },
      }),
    [props.member.environmentId, props.member.workspaceRoot],
  );
  const worktreeRefsQuery = useEnvironmentQuery(refsAtom);
  const options = useMemo(
    () =>
      resolveProjectWorktreeOptions({
        refs: worktreeRefsQuery.data?.refs ?? [],
        workspaceRoot: props.member.workspaceRoot,
        repositoryRoot: props.member.repositoryIdentity?.rootPath ?? props.member.workspaceRoot,
      }),
    [
      props.member.repositoryIdentity?.rootPath,
      props.member.workspaceRoot,
      worktreeRefsQuery.data?.refs,
    ],
  );
  const selected = options.some((option) => option.worktreePath === props.member.workspaceRoot);

  return (
    <View className={props.divider ? "border-t border-border-subtle" : ""}>
      {props.label ? (
        <Text className="px-4 pt-4 text-sm font-t3-medium text-foreground-muted">
          {props.label}
        </Text>
      ) : null}
      {options.length === 0 ? (
        <Text className="p-4 text-sm text-foreground-muted">
          {worktreeRefsQuery.isPending
            ? "Loading worktrees"
            : worktreeRefsQuery.error
              ? "Worktrees unavailable"
              : "No worktrees available"}
        </Text>
      ) : (
        <>
          {!selected ? (
            <Text className="px-4 pt-4 text-sm text-foreground-muted">
              Current worktree unavailable
            </Text>
          ) : null}
          {options.map((option) => (
            <Pressable
              key={option.worktreePath}
              accessibilityRole="radio"
              accessibilityState={{
                checked: option.worktreePath === props.member.workspaceRoot,
                disabled: saving,
              }}
              disabled={saving}
              onPress={() => {
                if (option.worktreePath === props.member.workspaceRoot) return;
                setSaving(true);
                void updateProject({
                  environmentId: props.member.environmentId,
                  input: { projectId: props.member.id, workspaceRoot: option.worktreePath },
                })
                  .then((result) => {
                    if (
                      result._tag === "Success" &&
                      selectedProjectKey === derivePhysicalProjectKey(props.member)
                    ) {
                      selectProject(
                        derivePhysicalProjectKeyFromPath(
                          props.member.environmentId,
                          option.worktreePath,
                        ),
                      );
                    }
                  })
                  .finally(() => setSaving(false));
              }}
              className="flex-row items-center gap-3 border-t border-border-subtle p-4"
            >
              <View className="min-w-0 flex-1 gap-1">
                <Text className="text-base text-foreground">{option.branch}</Text>
                <Text className="text-sm text-foreground-muted" selectable>
                  {option.worktreePath}
                </Text>
              </View>
              {option.worktreePath === props.member.workspaceRoot ? (
                <SymbolView
                  name="checkmark"
                  size={18}
                  tintColorClassName="accent-icon"
                  type="monochrome"
                  weight="semibold"
                />
              ) : null}
            </Pressable>
          ))}
        </>
      )}
    </View>
  );
}
