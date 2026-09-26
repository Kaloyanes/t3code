import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useMemo, useState } from "react";

import type { SidebarProjectGroupMember } from "../../sidebarProjectGrouping";
import { useEnvironmentQuery } from "../../state/query";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { vcsEnvironment } from "../../state/vcs";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { resolveProjectWorktreeOptions } from "./ProjectSettingsPanel.logic";
import { SettingsRow } from "./settingsLayout";

export function ProjectMainWorktreeSetting({
  member,
  showEnvironment,
}: {
  member: SidebarProjectGroupMember;
  showEnvironment: boolean;
}) {
  const updateProject = useAtomCommand(projectEnvironment.update, { reportFailure: false });
  const [saving, setSaving] = useState(false);
  const refsAtom = useMemo(
    () =>
      vcsEnvironment.listRefs({
        environmentId: member.environmentId,
        input: { cwd: member.workspaceRoot, refKind: "local", worktreesOnly: true },
      }),
    [member.environmentId, member.workspaceRoot],
  );
  const refs = useEnvironmentQuery(refsAtom);
  const options = useMemo(
    () =>
      resolveProjectWorktreeOptions({
        refs: refs.data?.refs ?? [],
        workspaceRoot: member.workspaceRoot,
        repositoryRoot: member.repositoryIdentity?.rootPath ?? member.workspaceRoot,
      }),
    [member.repositoryIdentity?.rootPath, member.workspaceRoot, refs.data?.refs],
  );
  const selected = options.find((option) => option.worktreePath === member.workspaceRoot);

  return (
    <SettingsRow
      title={showEnvironment ? (member.environmentLabel ?? "Environment") : "Main worktree"}
      description={member.workspaceRoot}
      control={
        <Select
          value={selected?.worktreePath ?? null}
          onValueChange={(path) => {
            if (
              !path ||
              path === member.workspaceRoot ||
              !options.some((option) => option.worktreePath === path)
            )
              return;
            setSaving(true);
            void updateProject({
              environmentId: member.environmentId,
              input: { projectId: member.id, workspaceRoot: path },
            }).then((result) => {
              setSaving(false);
              if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
              const error = squashAtomCommandFailure(result);
              toastManager.add({
                type: "error",
                title: "Main worktree not saved",
                description: error instanceof Error ? error.message : "An error occurred.",
              });
            });
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label={`Main worktree on ${member.environmentLabel ?? "this environment"}`}
            disabled={saving || options.length === 0}
          >
            <SelectValue>
              {selected
                ? selected.branch
                : refs.isPending
                  ? "Loading worktrees"
                  : refs.error
                    ? "Worktrees unavailable"
                    : options.length === 0
                      ? "No worktrees"
                      : "Current worktree unavailable"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {options.map((option) => (
              <SelectItem key={option.worktreePath} value={option.worktreePath}>
                <span className="flex min-w-0 flex-col">
                  <span>{option.branch}</span>
                  <span className="text-xs text-muted-foreground">{option.worktreePath}</span>
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
