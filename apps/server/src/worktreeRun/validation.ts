import * as Path from "effect/Path";

function isWithin(path: Path.Path, root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

export function isProjectWorktreePath(input: {
  readonly path: Path.Path;
  readonly repositoryRoot: string;
  readonly projectRoot: string;
  readonly worktreeRoot: string | null;
  readonly workspacePath: string;
}): boolean {
  if (input.worktreeRoot === null) return false;

  const repositoryRoot = input.path.resolve(input.repositoryRoot);
  const projectRoot = input.path.resolve(input.projectRoot);
  const workspacePath = input.path.resolve(input.workspacePath);
  const worktreeRoot = input.path.resolve(input.worktreeRoot);
  if (!isWithin(input.path, repositoryRoot, projectRoot)) return false;

  const projectRelativePath = input.path.relative(repositoryRoot, projectRoot);
  return input.path.resolve(worktreeRoot, projectRelativePath) === workspacePath;
}
