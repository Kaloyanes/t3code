import * as NodeUtil from "node:util";
import * as Effect from "effect/Effect";

import { ProcessRunner } from "../processRunner.ts";
import { sanitizeAcpStderrExcerpt } from "../provider/acp/AcpStderr.ts";

export function sanitizeComposerBashText(text: string): string {
  let sanitized = NodeUtil.stripVTControlCharacters(text);
  for (const [name, value] of Object.entries(process.env)) {
    if (
      /(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|CREDENTIAL)/i.test(name) &&
      value &&
      value.length >= 4
    ) {
      sanitized = sanitized.replaceAll(value, "[redacted]");
    }
  }
  return sanitizeAcpStderrExcerpt(sanitized);
}

export const runComposerBashCommand = Effect.fnUntraced(function* (input: {
  readonly text: string;
  readonly cwd: string | undefined;
}) {
  if (!input.text.startsWith("!")) return null;
  const command = input.text.slice(1).trim();
  const runner = yield* ProcessRunner;
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
              const stdout = sanitizeComposerBashText(output.stdout);
              const stderr = sanitizeComposerBashText(output.stderr);
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
  const safeCommand = sanitizeComposerBashText(command);
  const detail = sanitizeComposerBashText(result.detail);
  return {
    command: safeCommand,
    failed: result.failed,
    detail,
    input: `The user already ran this one-off Bash command. Use its result as context; do not rerun it automatically.\n\nCommand: ${safeCommand}\n\n${detail}`,
  };
});
