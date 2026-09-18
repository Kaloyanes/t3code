import type { ProjectScript } from "@t3tools/contracts";

export const threadProjectScripts = (scripts: readonly ProjectScript[]) =>
  scripts.filter((script) => (script.scope ?? "thread") === "thread");
