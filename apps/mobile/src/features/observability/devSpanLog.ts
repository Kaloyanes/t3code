import * as Layer from "effect/Layer";
import * as Tracer from "effect/Tracer";

// Simulators share the host clock, so these lines line up with the server's trace file.
const MIN_LOGGED_SPAN_NANOS = 1_000_000n;

class LoggedSpan extends Tracer.NativeSpan {
  override end(endTime: bigint, exit: Parameters<Tracer.NativeSpan["end"]>[1]): void {
    super.end(endTime, exit);
    if (endTime - this.startTime < MIN_LOGGED_SPAN_NANOS) return;
    console.log(
      `[t3-span] ${JSON.stringify({
        name: this.name,
        startMs: Number(this.startTime / 1_000_000n),
        endMs: Number(endTime / 1_000_000n),
        ok: exit._tag === "Success",
        ...(this._attributes === undefined
          ? {}
          : { attributes: Object.fromEntries(this._attributes) }),
      })}`,
    );
  }
}

/** Dev builds started with `EXPO_PUBLIC_T3CODE_LOG_SPANS=1` print every span of 1 ms or more. */
export const layer =
  __DEV__ && process.env.EXPO_PUBLIC_T3CODE_LOG_SPANS === "1"
    ? Layer.succeed(Tracer.Tracer, Tracer.make({ span: (options) => new LoggedSpan(options) }))
    : Layer.empty;
