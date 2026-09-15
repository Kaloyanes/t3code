import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { IssueListResult } from "@t3tools/contracts";
import type {
  EnvironmentId,
  IssueAuthStatus,
  IssueAuthStatusInput,
  IssueCandidatesInput,
  IssueCandidatesResult,
  IssueCommentsInput,
  IssueCommentsResult,
  IssueDetail,
  IssueListEntry,
  IssueListInput,
  IssueRepositorySelection,
  IssueTemplatesInput,
  IssueTemplatesResult,
  ProjectId,
} from "@t3tools/contracts";
import { createIssueEnvironmentAtoms } from "@t3tools/client-runtime/state/issues";
import { useCallback, useMemo } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { formatEnvironmentQueryError } from "./query";

export const issueEnvironment = createIssueEnvironmentAtoms(connectionAtomRuntime);

export interface EnvironmentQueryTarget<Input> {
  readonly environmentId: EnvironmentId;
  readonly input: Input;
}

interface MergedIssueQueryView<A> {
  readonly values: ReadonlyArray<readonly [EnvironmentId, A]>;
  readonly error: string | null;
  readonly isPending: boolean;
}

function createMergedIssueQuery<Input, A>(
  label: string,
  atomFor: (
    target: EnvironmentQueryTarget<Input>,
  ) => Atom.Atom<AsyncResult.AsyncResult<A, unknown>>,
) {
  const family = Atom.family((key: string) =>
    Atom.make((get): MergedIssueQueryView<A> => {
      const targets = JSON.parse(key) as ReadonlyArray<EnvironmentQueryTarget<Input>>;
      const values: Array<readonly [EnvironmentId, A]> = [];
      let error: string | null = null;
      let isPending = false;
      for (const target of targets) {
        const result = get(atomFor(target));
        isPending ||= result.waiting;
        if (result._tag === "Failure" && error === null) {
          error = formatEnvironmentQueryError(result.cause);
        }
        const value = Option.getOrNull(AsyncResult.value(result));
        if (value !== null) values.push([target.environmentId, value]);
      }
      return { values, error, isPending };
    }).pipe(Atom.withLabel(`${label}:${key}`)),
  );
  const empty = Atom.make<MergedIssueQueryView<A>>({
    values: [],
    error: null,
    isPending: false,
  }).pipe(Atom.withLabel(`${label}:empty`));
  return function useMergedQuery(targets: ReadonlyArray<EnvironmentQueryTarget<Input>>) {
    const key = JSON.stringify(targets);
    const view = useAtomValue(targets.length === 0 ? empty : family(key));
    const refresh = useCallback(
      (override?: ReadonlyArray<EnvironmentQueryTarget<Input>>) => {
        for (const target of override ??
          (JSON.parse(key) as ReadonlyArray<EnvironmentQueryTarget<Input>>)) {
          appAtomRegistry.refresh(atomFor(target));
        }
      },
      [atomFor, key],
    );
    return { ...view, refresh };
  };
}

export interface MergedIssueList {
  readonly entries: ReadonlyArray<IssueListEntry>;
  readonly providers: IssueListResult["providers"];
  readonly errors: IssueListResult["errors"];
  readonly truncatedEnvironments: ReadonlyArray<EnvironmentId>;
  readonly nextCursorsByEnvironment: ReadonlyMap<EnvironmentId, IssueListResult["nextCursors"]>;
}

const useIssueListsQuery = createMergedIssueQuery("web-issues:list", issueEnvironment.list);

export function useIssueList(targets: ReadonlyArray<EnvironmentQueryTarget<IssueListInput>>): {
  readonly data: MergedIssueList | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: (override?: ReadonlyArray<EnvironmentQueryTarget<IssueListInput>>) => void;
} {
  const query = useIssueListsQuery(targets);
  const data = useMemo<MergedIssueList | null>(() => {
    if (query.values.length === 0) return null;
    const entries = query.values
      .flatMap(([, result]) => result.entries)
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const providers = query.values.flatMap(([, result]) => result.providers);
    const errors = query.values.flatMap(([, result]) => result.errors);
    const truncatedEnvironments = query.values.flatMap(([environmentId, result]) =>
      result.truncated ? [environmentId] : [],
    );
    const nextCursorsByEnvironment = new Map<EnvironmentId, IssueListResult["nextCursors"]>();
    for (const [environmentId, result] of query.values) {
      if (Object.keys(result.nextCursors).length > 0) {
        nextCursorsByEnvironment.set(environmentId, result.nextCursors);
      }
    }
    return { entries, providers, errors, truncatedEnvironments, nextCursorsByEnvironment };
  }, [query.values]);
  return { data, error: query.error, isPending: query.isPending, refresh: query.refresh };
}

const EMPTY_DETAIL_RESULT = Atom.make(AsyncResult.initial<IssueDetail, unknown>()).pipe(
  Atom.withLabel("web-issues:detail:empty"),
);
const EMPTY_COMMENTS_RESULT = Atom.make(AsyncResult.initial<IssueCommentsResult, unknown>()).pipe(
  Atom.withLabel("web-issues:comments:empty"),
);
const EMPTY_CANDIDATES_RESULT = Atom.make(
  AsyncResult.initial<IssueCandidatesResult, unknown>(),
).pipe(Atom.withLabel("web-issues:candidates:empty"));
const EMPTY_TEMPLATES_RESULT = Atom.make(AsyncResult.initial<IssueTemplatesResult, unknown>()).pipe(
  Atom.withLabel("web-issues:templates:empty"),
);
const EMPTY_AUTH_RESULT = Atom.make(AsyncResult.initial<IssueAuthStatus, unknown>()).pipe(
  Atom.withLabel("web-issues:auth-status:empty"),
);

function useIssueQuery<A, Input>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, unknown>>,
  active: boolean,
): {
  readonly data: A | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
} {
  const result = useAtomValue(atom);
  const refresh = useCallback(() => {
    if (active) appAtomRegistry.refresh(atom);
  }, [active, atom]);
  return {
    data: active ? Option.getOrNull(AsyncResult.value(result)) : null,
    error: active && result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
    isPending: active && result.waiting,
    refresh,
  };
}

export function useIssueDetail(
  target: EnvironmentQueryTarget<Parameters<typeof issueEnvironment.detail>[0]["input"]> | null,
): {
  readonly data: IssueDetail | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
} {
  return useIssueQuery(
    target === null ? EMPTY_DETAIL_RESULT : issueEnvironment.detail(target),
    target !== null,
  );
}

export function useIssueComments(target: EnvironmentQueryTarget<IssueCommentsInput> | null): {
  readonly data: IssueCommentsResult | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
} {
  return useIssueQuery(
    target === null ? EMPTY_COMMENTS_RESULT : issueEnvironment.comments(target),
    target !== null,
  );
}

export function useIssueCandidates(target: EnvironmentQueryTarget<IssueCandidatesInput> | null): {
  readonly data: IssueCandidatesResult | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
} {
  return useIssueQuery(
    target === null ? EMPTY_CANDIDATES_RESULT : issueEnvironment.candidates(target),
    target !== null,
  );
}

export function useIssueTemplates(target: EnvironmentQueryTarget<IssueTemplatesInput> | null): {
  readonly data: IssueTemplatesResult | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
} {
  return useIssueQuery(
    target === null ? EMPTY_TEMPLATES_RESULT : issueEnvironment.templates(target),
    target !== null,
  );
}

export function useIssueAuthStatus(target: EnvironmentQueryTarget<IssueAuthStatusInput> | null): {
  readonly data: IssueAuthStatus | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
} {
  return useIssueQuery(
    target === null ? EMPTY_AUTH_RESULT : issueEnvironment.authStatus(target),
    target !== null,
  );
}

export interface IssueDraft {
  readonly version: 1;
  readonly projectId: ProjectId;
  readonly host?: string;
  readonly repository: string;
  readonly templateId?: string;
  readonly title: string;
  readonly body: string;
  readonly labels: ReadonlyArray<string>;
  readonly assignees: ReadonlyArray<string>;
  readonly updatedAt: number;
}

const ISSUE_DRAFT_STORAGE_KEY = "t3code:issue-drafts:v1";
const ISSUE_SELECTION_STORAGE_KEY = "t3code:issue-selection:v1";
const ISSUE_SNAPSHOT_STORAGE_KEY = "t3code:issue-snapshots:v1";
const MAX_DRAFTS = 100;
const MAX_SNAPSHOTS = 100;

export function issueDraftKey(selection: IssueRepositorySelection): string {
  return JSON.stringify([
    selection.projectId,
    selection.host?.toLowerCase() ?? null,
    selection.repository.toLowerCase(),
  ]);
}

function readDraftMap(storage?: Pick<Storage, "getItem">): Record<string, IssueDraft> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(ISSUE_DRAFT_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => {
        if (!value || typeof value !== "object") return false;
        const draft = value as Partial<IssueDraft>;
        return (
          draft.version === 1 &&
          typeof draft.projectId === "string" &&
          typeof draft.repository === "string" &&
          typeof draft.title === "string" &&
          typeof draft.body === "string" &&
          Array.isArray(draft.labels) &&
          Array.isArray(draft.assignees) &&
          typeof draft.updatedAt === "number"
        );
      }),
    ) as Record<string, IssueDraft>;
  } catch {
    return {};
  }
}

export function readIssueDraft(
  storage: Pick<Storage, "getItem"> | undefined,
  selection: IssueRepositorySelection,
): IssueDraft | null {
  return readDraftMap(storage)[issueDraftKey(selection)] ?? null;
}

export function writeIssueDraft(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  selection: IssueRepositorySelection,
  draft: Omit<IssueDraft, "version" | "projectId" | "host" | "repository" | "updatedAt"> &
    Partial<Pick<IssueDraft, "host">>,
  now = Date.now(),
): void {
  if (!storage) return;
  const current = readDraftMap(storage);
  const entry: IssueDraft = {
    version: 1,
    projectId: selection.projectId,
    ...(selection.host === undefined ? {} : { host: selection.host }),
    repository: selection.repository,
    ...(draft.templateId === undefined ? {} : { templateId: draft.templateId }),
    title: draft.title,
    body: draft.body,
    labels: [...draft.labels],
    assignees: [...draft.assignees],
    updatedAt: now,
  };
  current[issueDraftKey(selection)] = entry;
  const bounded = Object.fromEntries(
    Object.entries(current)
      .toSorted(([, left], [, right]) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_DRAFTS),
  );
  try {
    storage.setItem(ISSUE_DRAFT_STORAGE_KEY, JSON.stringify(bounded));
  } catch {
    // Persistence is best effort; a blocked store must not stop issue creation.
  }
}

export function clearIssueDraft(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  selection: IssueRepositorySelection,
): void {
  if (!storage) return;
  const current = readDraftMap(storage);
  delete current[issueDraftKey(selection)];
  try {
    storage.setItem(ISSUE_DRAFT_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Persistence is best effort, as in writeIssueDraft.
  }
}

function validIssueSelection(value: unknown): value is IssueRepositorySelection {
  if (!value || typeof value !== "object") return false;
  const selection = value as Partial<IssueRepositorySelection>;
  return (
    typeof selection.projectId === "string" &&
    typeof selection.repository === "string" &&
    selection.repository.trim().length > 0 &&
    (selection.host === undefined || typeof selection.host === "string")
  );
}

export function readIssueRepositorySelection(
  storage?: Pick<Storage, "getItem">,
): IssueRepositorySelection | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(ISSUE_SELECTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return validIssueSelection(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeIssueRepositorySelection(
  storage: Pick<Storage, "setItem"> | undefined,
  selection: IssueRepositorySelection,
): void {
  if (!storage) return;
  try {
    storage.setItem(ISSUE_SELECTION_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Persistence is best effort; the URL remains authoritative for this visit.
  }
}

export interface IssueListSnapshot {
  readonly version: 1;
  readonly savedAt: number;
  readonly result: IssueListResult;
}

const decodeIssueListSnapshot = Schema.decodeUnknownOption(
  Schema.Struct({
    version: Schema.Literal(1),
    savedAt: Schema.Number,
    result: IssueListResult,
  }),
);

function readSnapshotMap(storage?: Pick<Storage, "getItem">): Record<string, IssueListSnapshot> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(ISSUE_SNAPSHOT_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => {
        const snapshot = decodeIssueListSnapshot(value);
        return Option.isSome(snapshot) ? [[key, snapshot.value] as const] : [];
      }),
    );
  } catch {
    return {};
  }
}

export function readIssueListSnapshot(
  storage: Pick<Storage, "getItem"> | undefined,
  key: string,
): IssueListSnapshot | null {
  return readSnapshotMap(storage)[key] ?? null;
}

export function writeIssueListSnapshot(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  key: string,
  result: IssueListResult,
  savedAt = Date.now(),
): void {
  if (!storage) return;
  const current = readSnapshotMap(storage);
  current[key] = { version: 1, savedAt, result };
  const bounded = Object.fromEntries(
    Object.entries(current)
      .toSorted(([, left], [, right]) => right.savedAt - left.savedAt)
      .slice(0, MAX_SNAPSHOTS),
  );
  try {
    storage.setItem(ISSUE_SNAPSHOT_STORAGE_KEY, JSON.stringify(bounded));
  } catch {
    // Persistence is best effort; a failed cache write must not hide live results.
  }
}
