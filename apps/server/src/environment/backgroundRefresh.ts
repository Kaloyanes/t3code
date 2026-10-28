import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

interface RefreshState<A> {
  readonly value: Option.Option<A>;
  readonly computedAtNanos: bigint;
  readonly refreshing: boolean;
}

/**
 * Serves the last computed value at once and recomputes it in the background once it is older
 * than `maxAge`. Only reads before the first compute finishes wait; `warm` starts that compute
 * now. Server config is on every client's connect path, so slow host probes must not run inside it.
 */
export const makeBackgroundRefreshed = Effect.fnUntraced(function* <A>(
  compute: Effect.Effect<A>,
  maxAge: Duration.Input,
  options?: { readonly warm?: boolean },
) {
  const scope = yield* Effect.scope;
  const maxAgeNanos = Duration.toNanosUnsafe(maxAge);
  const first = yield* Deferred.make<A>();
  const state = yield* Ref.make<RefreshState<A>>({
    value: Option.none(),
    computedAtNanos: 0n,
    refreshing: false,
  });

  const startRefresh = Ref.modify(state, (current) =>
    current.refreshing
      ? ([false, current] as const)
      : ([true, { ...current, refreshing: true }] as const),
  ).pipe(
    Effect.flatMap((start) =>
      start
        ? compute.pipe(
            Effect.flatMap((value) =>
              Clock.monotonicTimeNanos.pipe(
                Effect.flatMap((computedAtNanos) =>
                  Ref.set(state, { value: Option.some(value), computedAtNanos, refreshing: false }),
                ),
                Effect.andThen(Deferred.succeed(first, value)),
              ),
            ),
            Effect.onExit((exit) =>
              Exit.isSuccess(exit)
                ? Effect.void
                : Ref.update(state, (current) => ({ ...current, refreshing: false })),
            ),
            Effect.forkIn(scope),
            Effect.asVoid,
          )
        : Effect.void,
    ),
  );

  if (options?.warm === true) yield* startRefresh;

  return Effect.gen(function* () {
    const current = yield* Ref.get(state);
    if (Option.isNone(current.value)) {
      yield* startRefresh;
      return yield* Deferred.await(first);
    }
    const now = yield* Clock.monotonicTimeNanos;
    if (now - current.computedAtNanos >= maxAgeNanos) {
      yield* startRefresh;
    }
    return current.value.value;
  });
});
