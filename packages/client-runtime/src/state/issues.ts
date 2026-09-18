import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

/**
 * Environment-scoped atoms for the GitHub Issues surface.
 *
 * Reads deliberately keep the server's responses in SWR caches: issue lists can
 * be revisited while a user edits a form, and detail/comment queries are keyed
 * by the full contract input (including repository and host). Mutations are
 * serialized per environment because gh operations are order-sensitive and a
 * confirmed result is the only safe point for clients to update their UI.
 */
export function createIssueEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const serialPerEnvironment = {
    mode: "serial",
    key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
  } as const;

  const list = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:issues:list",
    tag: WS_METHODS.issuesList,
    staleTimeMs: 30_000,
    idleTtlMs: 5 * 60_000,
  });
  const detail = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:issues:detail",
    tag: WS_METHODS.issuesDetail,
    staleTimeMs: 30_000,
    idleTtlMs: 5 * 60_000,
  });
  const comments = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:issues:comments",
    tag: WS_METHODS.issuesComments,
    staleTimeMs: 30_000,
    idleTtlMs: 5 * 60_000,
  });
  const candidates = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:issues:candidates",
    tag: WS_METHODS.issuesCandidates,
    staleTimeMs: 60_000,
    idleTtlMs: 5 * 60_000,
  });
  const templates = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:issues:templates",
    tag: WS_METHODS.issuesTemplates,
    staleTimeMs: 5 * 60_000,
    idleTtlMs: 10 * 60_000,
  });
  const authStatus = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:issues:auth-status",
    tag: WS_METHODS.issuesAuthStatus,
    staleTimeMs: 60_000,
    idleTtlMs: 5 * 60_000,
  });

  return {
    list,
    detail,
    comments,
    candidates,
    templates,
    authStatus,
    create: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:issues:create",
      tag: WS_METHODS.issuesCreate,
      scheduler,
      concurrency: serialPerEnvironment,
    }),
    update: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:issues:update",
      tag: WS_METHODS.issuesUpdate,
      scheduler,
      concurrency: serialPerEnvironment,
    }),
    commentCreate: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:issues:comment-create",
      tag: WS_METHODS.issuesCommentCreate,
      scheduler,
      concurrency: serialPerEnvironment,
    }),
    commentUpdate: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:issues:comment-update",
      tag: WS_METHODS.issuesCommentUpdate,
      scheduler,
      concurrency: serialPerEnvironment,
    }),
    commentDelete: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:issues:comment-delete",
      tag: WS_METHODS.issuesCommentDelete,
      scheduler,
      concurrency: serialPerEnvironment,
    }),
    reactionUpdate: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:issues:reaction-update",
      tag: WS_METHODS.issuesReactionUpdate,
      scheduler,
      concurrency: serialPerEnvironment,
    }),
    close: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:issues:close",
      tag: WS_METHODS.issuesClose,
      scheduler,
      concurrency: serialPerEnvironment,
    }),
    reopen: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:issues:reopen",
      tag: WS_METHODS.issuesReopen,
      scheduler,
      concurrency: serialPerEnvironment,
    }),
    invalidate: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:issues:invalidate",
      tag: WS_METHODS.issuesInvalidate,
      scheduler,
      concurrency: serialPerEnvironment,
    }),
    link: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:issues:link",
      tag: WS_METHODS.issuesLink,
      scheduler,
      concurrency: serialPerEnvironment,
    }),
    worktreePrepare: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:issues:worktree-prepare",
      tag: WS_METHODS.issuesWorktreePrepare,
      scheduler,
      concurrency: serialPerEnvironment,
    }),
    worktreeDeletePreflight: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:issues:worktree-delete-preflight",
      tag: WS_METHODS.issuesWorktreeDeletePreflight,
      scheduler,
      concurrency: serialPerEnvironment,
    }),
    worktreeDelete: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:issues:worktree-delete",
      tag: WS_METHODS.issuesWorktreeDelete,
      scheduler,
      concurrency: serialPerEnvironment,
    }),
    worktreeReplace: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:issues:worktree-replace",
      tag: WS_METHODS.issuesWorktreeReplace,
      scheduler,
      concurrency: serialPerEnvironment,
    }),
    authStart: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:issues:auth-start",
      tag: WS_METHODS.issuesAuthStart,
      scheduler,
      concurrency: serialPerEnvironment,
    }),
    authCancel: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:issues:auth-cancel",
      tag: WS_METHODS.issuesAuthCancel,
      scheduler,
      concurrency: serialPerEnvironment,
    }),
  };
}
