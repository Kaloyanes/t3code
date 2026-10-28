import Svg, { Circle } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedCircle = withUniwind(Circle);

const RADIUS = 8;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Fills clockwise with `fraction` in the color `colorClassName` resolves to. */
export function ProgressRing(props: {
  readonly fraction: number;
  readonly size: number;
  readonly colorClassName: string;
}) {
  const filled = Math.min(1, Math.max(0, props.fraction));
  return (
    <Svg width={props.size} height={props.size} viewBox="0 0 20 20" accessible={false}>
      <ThemedCircle
        cx={10}
        cy={10}
        r={RADIUS}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.2}
        strokeWidth={3}
        colorClassName={props.colorClassName}
      />
      {filled > 0 ? (
        <ThemedCircle
          cx={10}
          cy={10}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={`${CIRCUMFERENCE * filled} ${CIRCUMFERENCE}`}
          rotation={-90}
          origin="10, 10"
          colorClassName={props.colorClassName}
        />
      ) : null}
    </Svg>
  );
}
