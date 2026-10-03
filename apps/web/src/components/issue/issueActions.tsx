import * as Cause from "effect/Cause";
import { useCallback, useRef, useState } from "react";

function failureDetail(cause: unknown): string {
  let error = cause;
  if (cause !== undefined) {
    try {
      error = Cause.squash(cause as Cause.Cause<unknown>);
    } catch {
      error = cause;
    }
  }
  if (typeof error === "string") return error.trim();
  if (error && typeof error === "object") {
    if ("detail" in error && typeof error.detail === "string") return error.detail.trim();
    if ("message" in error && typeof error.message === "string") return error.message.trim();
  }
  return error instanceof Error ? error.message.trim() : "";
}

export function formatActionError(fallback: string, detail: unknown): string {
  const message = failureDetail(detail)
    .replace(/^Issue operation [^:]+ failed:\s*/i, "")
    .trim();
  if (message.length === 0) return `${fallback}. Try again.`;
  const sentence = /[.!?]$/.test(message) ? message : `${message}.`;
  return `${fallback}: ${sentence}${/try again/i.test(message) ? "" : " Try again."}`;
}

function errorMessage(
  result: { readonly _tag: string; readonly cause?: unknown },
  fallback: string,
): string {
  if (result._tag !== "Failure") return "";
  return formatActionError(fallback, result.cause);
}

function isInterruptedAction(result: { readonly _tag: string; readonly cause?: unknown }): boolean {
  return (
    result._tag === "Failure" &&
    result.cause !== undefined &&
    Cause.hasInterruptsOnly(result.cause as Cause.Cause<unknown>)
  );
}

export type ScopedActionOperation = () => Promise<{
  readonly _tag: string;
  readonly value?: unknown;
  readonly cause?: unknown;
}>;

export function useScopedActions() {
  const [pendingScopes, setPendingScopes] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(
    () => new Map<string, string>(),
  );
  const pendingRef = useRef<Set<string>>(new Set());

  const hasPending = (scope: string): boolean => pendingScopes.has(scope);
  const errorFor = (scope: string): string | null => errors.get(scope) ?? null;
  const run = useCallback(
    async (
      scope: string,
      fallback: string,
      operation: ScopedActionOperation,
      onSuccess?: (value: unknown) => void,
    ): Promise<boolean> => {
      if (pendingRef.current.has(scope)) return false;
      pendingRef.current.add(scope);
      setPendingScopes((current) => {
        const next = new Set(current);
        next.add(scope);
        return next;
      });
      setErrors((current) => {
        if (!current.has(scope)) return current;
        const next = new Map(current);
        next.delete(scope);
        return next;
      });
      try {
        const result = await operation();
        if (result._tag === "Success") {
          onSuccess?.(result.value);
          return true;
        }
        if (!isInterruptedAction(result)) {
          setErrors((current) => new Map(current).set(scope, errorMessage(result, fallback)));
        }
        return false;
      } catch (cause) {
        setErrors((current) => new Map(current).set(scope, formatActionError(fallback, cause)));
        return false;
      } finally {
        pendingRef.current.delete(scope);
        setPendingScopes((current) => {
          const next = new Set(current);
          next.delete(scope);
          return next;
        });
      }
    },
    [],
  );

  return { pendingScopes, hasPending, errorFor, run };
}

export function ActionFeedback({
  pending,
  pendingLabel,
  error,
}: {
  readonly pending: boolean;
  readonly pendingLabel: string;
  readonly error: string | null;
}) {
  if (!pending && !error) return null;
  return pending ? (
    <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
      {pendingLabel}
    </p>
  ) : (
    <p className="text-xs text-destructive" role="alert">
      {error}
    </p>
  );
}
