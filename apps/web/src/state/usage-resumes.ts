import { createUsageResumeEnvironmentAtoms } from "@t3tools/client-runtime/state/usage-resumes";

import { connectionAtomRuntime } from "../connection/runtime";

export const usageResumeEnvironment = createUsageResumeEnvironmentAtoms(connectionAtomRuntime);
