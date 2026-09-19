import { createWorktreeRunEnvironmentAtoms } from "@t3tools/client-runtime/state/worktreeRun";
import { connectionAtomRuntime } from "../connection/runtime";

export const worktreeRunEnvironment = createWorktreeRunEnvironmentAtoms(connectionAtomRuntime);
