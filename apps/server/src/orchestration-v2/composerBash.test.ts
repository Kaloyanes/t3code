import * as NodeOS from "node:os";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProcessRunner from "../processRunner.ts";
import { runComposerBashCommand, sanitizeComposerBashText } from "./composerBash.ts";

const live = ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer));
const run = (text: string) =>
  runComposerBashCommand({ text, cwd: NodeOS.tmpdir() }).pipe(Effect.provide(live));

describe("composer Bash commands", () => {
  it.effect("leaves ordinary messages alone", () =>
    Effect.gen(function* () {
      expect(yield* run("Explain !false")).toBeNull();
      expect(yield* run("hello")).toBeNull();
    }),
  );

  it.effect("captures stdout and stderr from one Bash execution", () =>
    Effect.gen(function* () {
      const result = yield* run("!printf 'build output'; printf 'build warning' >&2; exit 2");
      expect(result?.failed).toBe(true);
      expect(result?.detail).toContain("Exit code: 2");
      expect(result?.detail).toContain("build output");
      expect(result?.detail).toContain("build warning");
      expect(result?.input).toContain("already ran");
    }),
  );

  it.effect.each(["!true", "!printf '\\n'", "!printf '\\033[0m'"])(
    "reports empty output explicitly for %s",
    (command) =>
      Effect.gen(function* () {
        const result = yield* run(command);
        expect(result?.failed).toBe(false);
        expect(result?.detail).toBe("Exit code: 0\n(no output)");
      }),
  );

  it("redacts secret environment values", () => {
    vi.stubEnv("T3_TEST_SECRET", "example-private-value");
    try {
      expect(sanitizeComposerBashText("value=example-private-value")).toBe("value=[redacted]");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.effect("does not execute without a thread workspace", () =>
    Effect.gen(function* () {
      const result = yield* runComposerBashCommand({ text: "!pwd", cwd: undefined }).pipe(
        Effect.provide(live),
      );
      expect(result?.failed).toBe(true);
      expect(result?.detail).toContain("no workspace");
    }),
  );

  it.effect("rejects an empty command", () =>
    Effect.gen(function* () {
      const result = yield* run("!  ");
      expect(result?.failed).toBe(true);
      expect(result?.detail).toContain("Enter a Bash command after !");
    }),
  );

  it.effect("bounds output and redacts recognizable credentials", () =>
    Effect.gen(function* () {
      const result = yield* run("!printf 'Bearer example-secret\\n'; printf '%20000s' x");
      expect(result?.detail).toContain("Bearer [redacted]");
      expect(result?.detail).not.toContain("example-secret");
      expect(result?.detail).toContain("[output truncated]");
      expect(result!.detail.length).toBeLessThan(17000);
    }),
  );

  it.effect("reports a timeout without claiming success", () =>
    Effect.gen(function* () {
      const result = yield* runComposerBashCommand({ text: "!build", cwd: "/workspace" }).pipe(
        Effect.provideService(ProcessRunner.ProcessRunner, {
          run: () =>
            Effect.succeed({
              stdout: "",
              stderr: "",
              code: null,
              timedOut: true,
              stdoutTruncated: false,
              stderrTruncated: false,
              stdoutInvalidUtf8: false,
              stderrInvalidUtf8: false,
            }),
        }),
      );
      expect(result?.failed).toBe(true);
      expect(result?.detail).toContain("timed out after 60 seconds");
    }),
  );

  it.effect("does not expose process failure causes", () =>
    Effect.gen(function* () {
      const result = yield* runComposerBashCommand({ text: "!build", cwd: "/workspace" }).pipe(
        Effect.provideService(ProcessRunner.ProcessRunner, {
          run: () =>
            Effect.fail(
              new ProcessRunner.ProcessSpawnError({
                command: "bash",
                argumentCount: 2,
                cause: "private credential",
              }),
            ),
        }),
      );
      expect(result?.detail).toContain("Bash could not be started");
      expect(result?.input).not.toContain("private credential");
    }),
  );
});
