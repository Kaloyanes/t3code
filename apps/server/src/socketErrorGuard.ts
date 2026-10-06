// @effect-diagnostics globalConsole:off -- Process-level handler outside an Effect runtime; stderr must match Node's default print.
/**
 * Node 24.21's bundled undici calls `socket.setTypeOfService` on sockets the OS
 * has already invalidated, and the resulting EINVAL is thrown from a socket
 * event handler where nothing can catch it. Uncaught, it kills the whole
 * server and every running thread with it.
 */
export const isSetTypeOfServiceFailure = (error: unknown): boolean =>
  error instanceof Error &&
  (error as NodeJS.ErrnoException).code === "EINVAL" &&
  (error as NodeJS.ErrnoException).syscall === "setTypeOfService";

let installed = false;

/**
 * Keeps the server alive through the failure above. Any other uncaught
 * exception still takes the default path: print and exit 1.
 */
export const installSocketErrorGuard = (): void => {
  if (installed) return;
  installed = true;
  process.on("uncaughtException", (error, origin) => {
    if (isSetTypeOfServiceFailure(error)) {
      console.error("Ignored setTypeOfService EINVAL from a dead socket.", error);
      return;
    }
    // Another handler registered besides this one owns the decision.
    if (process.listenerCount("uncaughtException") > 1) return;
    console.error(origin === "unhandledRejection" ? "Unhandled rejection:" : "Uncaught exception:");
    console.error(error);
    process.exit(1);
  });
};
