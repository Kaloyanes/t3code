import * as NodeUtil from "node:util";
import * as Effect from "effect/Effect";
import * as HostProcess from "@t3tools/shared/HostProcess";

import { ProcessRunner } from "../processRunner.ts";
import { sanitizeAcpStderrExcerpt } from "@t3tools/provider-acp/server/stderr";

export function sanitizeComposerBashText(
  text: string,
  homeDirectory: string,
  environment: NodeJS.ProcessEnv,
): string {
  let sanitized = NodeUtil.stripVTControlCharacters(text);
  for (const [name, value] of Object.entries(environment)) {
    if (
      /(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|CREDENTIAL)/i.test(name) &&
      value &&
      value.length >= 4
    ) {
      sanitized = sanitized.replaceAll(value, "[redacted]");
    }
  }
  return sanitizeAcpStderrExcerpt(sanitized, homeDirectory, environment);
}

export const runComposerBashCommand = Effect.fnUntraced(function* (input: {
  readonly text: string;
  readonly cwd: string | undefined;
}) {
  if (!input.text.startsWith("!")) return null;
  const command = input.text.slice(1).trim();
  const runner = yield* ProcessRunner;
  const homeDirectory = yield* HostProcess.HomeDirectory;
  const environment = yield* HostProcess.Environment;
  const sanitize = (text: string) => sanitizeComposerBashText(text, homeDirectory, environment);
  const result = !command
    ? { failed: true, detail: "Enter a Bash command after !." }
    : !input.cwd
      ? { failed: true, detail: "The thread has no workspace to run this command in." }
      : yield* runner
          .run({
            command: "bash",
            args: ["--noprofile", "--norc", "-c", command],
            cwd: input.cwd,
            stdin: "",
            timeout: "60 seconds",
            timeoutBehavior: "timedOutResult",
            maxOutputBytes: 16 * 1024,
            outputMode: "truncate",
            truncatedMarker: "\n[output truncated]",
            env: { BASH_ENV: "", ENV: "" },
          })
          .pipe(
            Effect.map((output) => {
              const stdout = sanitize(output.stdout);
              const stderr = sanitize(output.stderr);
              return {
                failed: output.timedOut || output.code !== 0,
                detail: output.timedOut
                  ? "Bash command timed out after 60 seconds. Partial output is unavailable."
                  : [
                      `Exit code: ${output.code ?? "unknown"}`,
                      ...(stdout ? [`stdout:\n${stdout}`] : []),
                      ...(stderr ? [`stderr:\n${stderr}`] : []),
                      ...(!stdout && !stderr ? ["(no output)"] : []),
                    ].join("\n"),
              };
            }),
            Effect.catch((error) =>
              Effect.succeed({
                failed: true,
                detail:
                  error._tag === "ProcessSpawnError"
                    ? "Bash could not be started. Check that Bash is installed and the workspace exists."
                    : "Bash command failed while collecting its output.",
              }),
            ),
          );
  const safeCommand = sanitize(command);
  const detail = sanitize(result.detail);
  return {
    command: safeCommand,
    failed: result.failed,
    detail,
    input: `The user already ran this one-off Bash command. Use its result as context; do not rerun it automatically.\n\nCommand: ${safeCommand}\n\n${detail}`,
  };
});
