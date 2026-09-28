import { EMPTY_TERMINAL_SESSION_STATE } from "@t3tools/client-runtime/state/terminal";
import { worktreeRunEnvironment } from "../state/worktreeRun";
import { useEnvironmentQuery } from "../state/query";
import { TerminalSessionViewport, type TerminalSessionViewportProps } from "./ThreadTerminalDrawer";
import { useAtomCommand } from "../state/use-atom-command";
import type { WorktreeRunTerminalTarget } from "../worktreeRunTerminalStore";

export function WorktreeRunTerminal({
  active,
  ...props
}: {
  active: WorktreeRunTerminalTarget;
} & Omit<
  TerminalSessionViewportProps,
  | "sessionKey"
  | "terminalId"
  | "cwd"
  | "terminalSession"
  | "write"
  | "resize"
  | "onSessionExited"
  | "onAddTerminalContext"
>) {
  const write = useAtomCommand(worktreeRunEnvironment.write, { reportFailure: false });
  const resize = useAtomCommand(worktreeRunEnvironment.resize);
  const attach = useEnvironmentQuery(
    worktreeRunEnvironment.attach({ environmentId: active.environmentId, input: active.target }),
  );
  const sessionKey = JSON.stringify([
    active.environmentId,
    active.target.projectId,
    active.target.workspacePath,
    active.target.scriptId,
  ]);
  return (
    <TerminalSessionViewport
      {...props}
      key={sessionKey}
      sessionKey={sessionKey}
      terminalId={sessionKey}
      cwd={active.target.workspacePath}
      terminalSession={{
        output: attach.data?.output ?? EMPTY_TERMINAL_SESSION_STATE.output,
        status: attach.data?.status ?? "starting",
        version: attach.data?.version ?? 0,
        error: attach.error,
      }}
      write={(data) =>
        write({ environmentId: active.environmentId, input: { ...active.target, data } })
      }
      resize={(cols, rows) =>
        resize({ environmentId: active.environmentId, input: { ...active.target, cols, rows } })
      }
    />
  );
}
