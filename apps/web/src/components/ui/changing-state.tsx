import { motion } from "motion/react";
import autoAnimate from "@formkit/auto-animate";
import { RollingNumber } from "@kitlangton/rolling-number/react";
import "@kitlangton/rolling-number/styles.css";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ElementType,
  type ReactNode,
  type RefCallback,
} from "react";

import { cn } from "~/lib/utils";
import { useUiAnimationSettings } from "../../uiAnimations";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

interface AnimatedTextValue {
  readonly changeKey: string;
  readonly value: string;
}

export const AnimatedText = memo(function AnimatedText({
  value,
  changeKey = value,
  as: Component = "span",
  className,
}: {
  readonly value: string;
  readonly changeKey?: string;
  readonly as?: ElementType;
  readonly className?: string;
}) {
  const { active, durationMs } = useUiAnimationSettings();
  const [transition, setTransition] = useState<{
    current: AnimatedTextValue;
    previous: AnimatedTextValue | null;
  }>({ current: { changeKey, value }, previous: null });
  if (
    transition.current.changeKey !== changeKey ||
    transition.current.value !== value ||
    (!active && transition.previous !== null)
  ) {
    setTransition({
      current: { changeKey, value },
      previous: active ? transition.current : null,
    });
  }
  const letters = active && transition.previous ? Array.from(graphemes.segment(value)) : [];
  // Keep joined scripts shaped as a run and bound the number of animated elements.
  const parts =
    letters.length > 120 ||
    /[^\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Common}\p{Script=Inherited}]/u.test(
      value,
    )
      ? [{ segment: value, index: 0 }]
      : letters;
  const staggerMs = Math.min(60, durationMs * 0.3);

  return (
    <Component className={cn("changing-text", className)}>
      <span className="sr-only select-none">{value}</span>
      {active && transition.previous ? (
        <motion.span
          key={JSON.stringify([
            transition.previous.changeKey,
            transition.previous.value,
            "outgoing",
          ])}
          aria-hidden="true"
          className="changing-text-content changing-text-exit"
          data-changing-text="outgoing"
          initial={{ opacity: 1, filter: "blur(0px)", transform: "translateY(0px)" }}
          animate={{ opacity: 0, filter: "blur(2px)", transform: "translateY(-3px)" }}
          transition={{ type: "tween", duration: durationMs / 1000, ease: "easeIn" }}
          onAnimationComplete={() => {
            setTransition((current) =>
              current.previous === transition.previous ? { ...current, previous: null } : current,
            );
          }}
        >
          {transition.previous.value}
        </motion.span>
      ) : null}
      <span
        key={JSON.stringify([transition.current.changeKey, transition.current.value])}
        aria-hidden="true"
        className="changing-text-content"
        data-changing-text="incoming"
      >
        {active && transition.previous
          ? parts.map(({ segment, index: offset }, index) => (
              <motion.span
                key={offset}
                className="changing-text-letter"
                initial={{ opacity: 0, filter: "blur(2px)", transform: "translateY(3px)" }}
                animate={{ opacity: 1, filter: "blur(0px)", transform: "translateY(0px)" }}
                transition={{
                  type: "tween",
                  duration: (durationMs - staggerMs) / 1000,
                  delay: (staggerMs * index) / Math.max(1, parts.length - 1) / 1000,
                  ease: [0.23, 1, 0.32, 1],
                }}
              >
                {segment}
              </motion.span>
            ))
          : value}
      </span>
    </Component>
  );
});

export const AnimatedIcon = memo(function AnimatedIcon({
  stateKey,
  children,
  className,
}: {
  readonly stateKey: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const { active, durationMs } = useUiAnimationSettings();
  const [state, setState] = useState({ key: stateKey, changed: false });
  if (state.key !== stateKey || (!active && state.changed)) {
    setState({ key: stateKey, changed: active });
  }

  return (
    <span className={cn("changing-icon", className)} data-changing-state={stateKey}>
      {active && state.changed ? (
        <motion.span
          key={stateKey}
          className="changing-icon-content"
          initial={{ opacity: 0, filter: "blur(2px)", transform: "translateY(2px) scale(0.92)" }}
          animate={{ opacity: 1, filter: "blur(0px)", transform: "translateY(0px) scale(1)" }}
          transition={{ type: "tween", duration: durationMs / 1000, ease: [0.23, 1, 0.32, 1] }}
        >
          {children}
        </motion.span>
      ) : (
        <span className="changing-icon-content">{children}</span>
      )}
    </span>
  );
});

/** Rolls changed digits in place; settles immediately when interface animations are off. */
export const AnimatedNumber = memo(function AnimatedNumber({
  value,
  format,
  className,
}: {
  readonly value: number;
  readonly format?: Intl.NumberFormatOptions;
  readonly className?: string;
}) {
  const { active, durationMs } = useUiAnimationSettings();
  return (
    <RollingNumber
      value={value}
      {...(format ? { format } : {})}
      // Digits travel farther than a fading label, so they get a little more time.
      duration={active ? durationMs * 2 : 0}
      animated={active}
      className={className}
    />
  );
});

export function useAnimatedLayout<T extends HTMLElement>(): RefCallback<T> {
  const { active, durationMs } = useUiAnimationSettings();
  const elementRef = useRef<T | null>(null);
  const setElement = useCallback((element: T | null) => {
    elementRef.current = element;
  }, []);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || typeof HTMLElement === "undefined") return;
    const controller = autoAnimate(element, {
      duration: durationMs,
      easing: "cubic-bezier(0.23, 1, 0.32, 1)",
    });
    if (!active) controller.disable();
    return () => controller.destroy?.();
  }, [active, durationMs]);

  return setElement;
}
