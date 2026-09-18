import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { type MouseEvent, useCallback } from "react";

import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { useProjects, useServerConfigs } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { findProjectForIssue, normalizeIssueHost } from "../components/issue/issue.logic";
import { useRightPanelStore } from "../rightPanelStore";

export interface IssueLink {
  readonly host: string;
  readonly repository: string;
  readonly number: number;
}

export function parseIssueUrl(value: string): IssueLink | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const segments = url.pathname
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return "";
      }
    })
    .filter((segment) => segment.length > 0);
  if (segments.length !== 4 || segments[2]?.toLowerCase() !== "issues") return null;
  const number = Number(segments[3]);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  const [owner, name] = segments;
  if (!owner || !name) return null;
  return { host: normalizeIssueHost(url.hostname), repository: `${owner}/${name}`, number };
}

export function shouldOpenIssueExternally(
  event: Pick<MouseEvent<HTMLElement>, "metaKey" | "ctrlKey">,
): boolean {
  return event.metaKey || event.ctrlKey;
}

function issueProjectsForEnvironment(
  projects: ReadonlyArray<EnvironmentProject>,
  serverConfigs: ReadonlyMap<
    EnvironmentId,
    { readonly environment: { readonly capabilities: { readonly issues?: boolean } } }
  >,
  environmentId: EnvironmentId | undefined,
): ReadonlyArray<EnvironmentProject> {
  if (environmentId !== undefined) {
    return projects.filter((project) => project.environmentId === environmentId);
  }
  return projects.filter(
    (project) => serverConfigs.get(project.environmentId)?.environment.capabilities.issues === true,
  );
}

export function useOpenIssueLink(
  threadRef?: ScopedThreadRef,
  panelRef?: ScopedThreadRef,
): (
  event: Pick<
    MouseEvent<HTMLElement>,
    "preventDefault" | "stopPropagation" | "metaKey" | "ctrlKey"
  >,
  targetUrl: string,
  targetEnvironmentId?: EnvironmentId,
) => boolean {
  const navigate = useNavigate();
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  return useCallback(
    (event, targetUrl, targetEnvironmentId) => {
      if (shouldOpenIssueExternally(event)) return false;
      const parsed = parseIssueUrl(targetUrl);
      if (parsed === null) return false;
      const resolvedPanelRef = panelRef ?? threadRef;
      const candidateProjects = issueProjectsForEnvironment(
        projects,
        serverConfigs,
        threadRef?.environmentId ?? targetEnvironmentId,
      ).toSorted(
        (left, right) =>
          Number(right.environmentId === primaryEnvironmentId) -
          Number(left.environmentId === primaryEnvironmentId),
      );
      const project = findProjectForIssue(candidateProjects, parsed);
      if (project === undefined) return false;
      event.preventDefault();
      event.stopPropagation();
      const target = {
        ...(resolvedPanelRef?.environmentId === project.environmentId
          ? {}
          : { environmentId: project.environmentId }),
        projectId: project.id,
        host: parsed.host,
        repository: parsed.repository,
        number: parsed.number,
        url: targetUrl,
      };
      if (resolvedPanelRef !== undefined) {
        useRightPanelStore.getState().openIssue(resolvedPanelRef, target);
      }
      if (threadRef === undefined || resolvedPanelRef === undefined) {
        void navigate({
          to: "/issues",
          search: {
            state: "all",
            projectId: project.id,
            host: parsed.host,
            selectedIssue: parsed.number,
          },
          replace: true,
        });
      }
      return true;
    },
    [navigate, panelRef, primaryEnvironmentId, projects, serverConfigs, threadRef],
  );
}

export function issueLinkExternalUrl(link: IssueLink): string {
  return `https://${link.host}/${link.repository}/issues/${link.number}`;
}
