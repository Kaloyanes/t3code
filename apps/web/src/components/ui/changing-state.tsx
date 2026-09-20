import autoAnimate from "@formkit/auto-animate";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type ElementType,
  type ReactNode,
  type RefCallback,
} from "react";

import { cn } from "~/lib/utils";
import { usePanelAnimationSettings } from "../../panelAnimations";

type ChangingStateStyle = CSSProperties & { "--changing-state-duration": string };
type ChangingTextStyle = CSSProperties & { "--changing-text-index": number };

const derivativeDuration = (durationMs: number) => Math.round(durationMs / 1.5);

function textTokens(value: string) {
  const occurrences = new Map<string, number>();
  return value.split(/(\s+)/).map((text, position) => {
    const occurrence = occurrences.get(text) ?? 0;
    occurrences.set(text, occurrence + 1);
    return { key: `${text}:${occurrence}`, position, text };
  });
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
  const { active, durationMs } = usePanelAnimationSettings();
  const tokens = textTokens(value);
  const style = {
    "--changing-state-duration": `${derivativeDuration(durationMs)}ms`,
  } as ChangingStateStyle;

  return (
    <Component aria-label={value} className={cn("changing-text", className)}>
      <span key={changeKey} aria-hidden="true" className="changing-text-content" style={style}>
        {tokens.map((token) =>
          /^\s+$/.test(token.text) ? (
            token.text
          ) : (
            <span
              key={token.key}
              className={cn(active && "changing-text-word")}
              style={{ "--changing-text-index": token.position } as ChangingTextStyle}
            >
              {token.text}
            </span>
          ),
        )}
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
    const { active, durationMs } = usePanelAnimationSettings();
    const style = {
      "--changing-state-duration": `${derivativeDuration(durationMs)}ms`,
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
  const { active, durationMs } = usePanelAnimationSettings();
  const elementRef = useRef<T | null>(null);
  const setElement = useCallback((element: T | null) => {
    elementRef.current = element;
  }, []);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || typeof HTMLElement === "undefined") return;
    const controller = autoAnimate(element, {
      duration: derivativeDuration(durationMs),
      easing: "cubic-bezier(0.23, 1, 0.32, 1)",
    });
    if (!active) controller.disable();
    return () => controller.destroy?.();
  }, [active, durationMs]);

  return setElement;
}
