import { cn } from "~/lib/utils";

/** Fills clockwise with `fraction` in the surrounding text color. */
export function ProgressRing({
  fraction,
  className,
}: {
  readonly fraction: number;
  readonly className?: string;
}) {
  const filled = Math.min(1, Math.max(0, fraction));
  return (
    <svg aria-hidden viewBox="0 0 20 20" className={cn("-rotate-90", className)}>
      <circle cx="10" cy="10" r="8" fill="none" strokeWidth="3" className="stroke-current/20" />
      <circle
        cx="10"
        cy="10"
        r="8"
        fill="none"
        strokeWidth="3"
        strokeLinecap={filled > 0 ? "round" : "butt"}
        pathLength={1}
        strokeDasharray="1 1"
        strokeDashoffset={1 - filled}
        className="stroke-current transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
      />
    </svg>
  );
}
