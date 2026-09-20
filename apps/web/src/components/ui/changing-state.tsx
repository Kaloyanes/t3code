import autoAnimate from "@formkit/auto-animate";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
  type RefCallback,
} from "react";

import { cn } from "~/lib/utils";
import { useUiAnimationSettings } from "../../uiAnimations";

type ChangingStateStyle = CSSProperties & { "--changing-state-duration": string };
interface AnimatedTextValue {
  readonly changeKey: string;
  readonly value: string;
}

export const AnimatedText = memo(function AnimatedText({
  value,
  changeKey,
  as: Component = "span",
  className,
}: {
  readonly value: string;
  readonly changeKey: string;
  readonly as?: ElementType;
  readonly className?: string;
}) {
  const { active, durationMs } = useUiAnimationSettings();
  const [transition, setTransition] = useState<{
    current: AnimatedTextValue;
    previous: AnimatedTextValue | null;
  }>({ current: { changeKey, value }, previous: null });
  if (transition.current.changeKey !== changeKey || transition.current.value !== value) {
    setTransition({
      current: { changeKey, value },
      previous: active ? transition.current : null,
    });
  }
  const style = {
    "--changing-state-duration": `${durationMs}ms`,
  } as ChangingStateStyle;

  return (
    <Component aria-label={value} className={cn("changing-text", className)}>
      {active && transition.previous ? (
        <span
          key={`${transition.previous.changeKey}:outgoing`}
          aria-hidden="true"
          className="changing-text-content changing-text-exit"
          data-changing-text="outgoing"
          onAnimationEnd={() => setTransition((current) => ({ ...current, previous: null }))}
          style={style}
        >
          {transition.previous.value}
        </span>
      ) : null}
      <span
        key={transition.current.changeKey}
        aria-hidden="true"
        className={cn("changing-text-content", active && "changing-text-enter")}
        data-changing-text="incoming"
        style={style}
      >
        {transition.current.value}
      </span>
    </Component>
  );
});

export const AnimatedIcon = memo(
  function AnimatedIcon({
    stateKey,
    children,
    className,
  }: {
    readonly stateKey: string;
    readonly children: ReactNode;
    readonly className?: string;
  }) {
    const { active, durationMs } = useUiAnimationSettings();
    const style = {
      "--changing-state-duration": `${durationMs}ms`,
    } as ChangingStateStyle;

    return (
      <span className={cn("changing-icon", className)} data-changing-state={stateKey} style={style}>
        <span key={stateKey} className={cn(active && "changing-icon-content")}>
          {children}
        </span>
      </span>
    );
  },
  (previous, next) => previous.stateKey === next.stateKey && previous.className === next.className,
);

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
