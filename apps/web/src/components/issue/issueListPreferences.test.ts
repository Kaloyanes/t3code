import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  issueListPreferences,
  readIssueListPreferences,
  rememberedIssueListFields,
  writeIssueListPreferences,
} from "./issueListPreferences";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe("issue list preferences", () => {
  it("round-trips the remembered fields and drops defaults", () => {
    const storage = memoryStorage();
    writeIssueListPreferences(
      {
        state: "closed",
        involvement: "all",
        sort: "comments",
        labels: ["bug"],
        assignee: "me",
        projectId: ProjectId.make("p1"),
        environmentId: EnvironmentId.make("e1"),
      },
      storage,
    );
    expect(readIssueListPreferences(storage)).toEqual({
      state: "closed",
      sort: "comments",
      labels: ["bug"],
      assignee: "me",
      projectId: "p1",
      environmentId: "e1",
    });
  });

  it("reads nothing from missing or malformed storage", () => {
    const storage = memoryStorage();
    expect(readIssueListPreferences(storage)).toBeNull();
    storage.setItem("t3code:issue-list-preferences:v1", "{not json");
    expect(readIssueListPreferences(storage)).toBeNull();
  });

  it("keeps a project scope over the all-projects marker", () => {
    expect(
      issueListPreferences({ state: "open", scope: "all", projectId: ProjectId.make("p1") }),
    ).toEqual({ state: "open", projectId: "p1" });
    expect(issueListPreferences({ state: "open", scope: "all" })).toEqual({
      state: "open",
      scope: "all",
    });
  });
});

describe("rememberedIssueListFields", () => {
  const remembered = {
    state: "closed" as const,
    sort: "created-asc" as const,
    labels: ["bug"],
    scope: "all" as const,
  };

  it("fills what a bare link leaves out", () => {
    expect(rememberedIssueListFields({}, remembered)).toEqual(remembered);
  });

  it("lets anything the link names win, part by part", () => {
    // The sidebar names a state and the active thread's project; filters still come back.
    expect(rememberedIssueListFields({ state: "open", projectId: "p1" }, remembered)).toEqual({
      sort: "created-asc",
      labels: ["bug"],
    });
    // A link naming any list control is taken as the whole list question.
    expect(rememberedIssueListFields({ author: "octo" }, remembered)).toEqual({
      state: "closed",
      scope: "all",
    });
    expect(rememberedIssueListFields({}, null)).toEqual({});
  });
});
