import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import { expect } from "vite-plus/test";

import { isProjectWorktreePath } from "./validation.ts";

it.layer(Path.layer)("isProjectWorktreePath", (it) => {
  it.effect("accepts a nested project path inside a linked worktree", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      expect(
        isProjectWorktreePath({
          path,
          repositoryRoot: "/repo",
          projectRoot: "/repo/apps/dashboard",
          worktreeRoot: "/worktrees/feature",
          workspacePath: "/worktrees/feature/apps/dashboard",
        }),
      ).toBe(true);
    }),
  );

  it.effect("accepts a repository-root project path", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      expect(
        isProjectWorktreePath({
          path,
          repositoryRoot: "/repo",
          projectRoot: "/repo",
          worktreeRoot: "/worktrees/feature",
          workspacePath: "/worktrees/feature",
        }),
      ).toBe(true);
    }),
  );

  it.effect("rejects a path for a different project inside the worktree", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      expect(
        isProjectWorktreePath({
          path,
          repositoryRoot: "/repo",
          projectRoot: "/repo/apps/dashboard",
          worktreeRoot: "/worktrees/feature",
          workspacePath: "/worktrees/feature/apps/web",
        }),
      ).toBe(false);
    }),
  );

  it.effect("rejects a project root outside the repository root", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      expect(
        isProjectWorktreePath({
          path,
          repositoryRoot: "/repo",
          projectRoot: "/other/dashboard",
          worktreeRoot: "/worktrees/feature",
          workspacePath: "/worktrees/feature/dashboard",
        }),
      ).toBe(false);
    }),
  );
});
