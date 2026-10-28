import type { OrchestrationV2PlanStep } from "@t3tools/contracts";
import type { TodoRunState } from "@t3tools/client-runtime/state/todo-progress";
import BottomSheet, { BottomSheetView } from "@expo/ui/community/bottom-sheet";
import { ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { useResolveClassNames } from "uniwind";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { cn } from "../../lib/cn";
import {
  presentThreadProgress,
  presentThreadProgressStep,
  THREAD_PROGRESS_TONE_CLASSES,
  type ThreadProgressTone,
} from "./thread-progress-presentation";

const SEGMENT_TRACK_CLASSES = {
  active: "bg-adaptive-sky-600-400/20",
  waiting: "bg-warning-foreground/20",
  done: "bg-adaptive-emerald-700-300/20",
  muted: "bg-foreground-muted/20",
} as const satisfies Record<ThreadProgressTone, string>;

const SEGMENT_FILL_CLASSES = {
  active: "bg-adaptive-sky-600-400",
  waiting: "bg-warning-foreground",
  done: "bg-adaptive-emerald-700-300",
  muted: "bg-foreground-muted",
} as const satisfies Record<ThreadProgressTone, string>;

const ROW_TINT_CLASSES = {
  active: "bg-adaptive-sky-600-400/10",
  waiting: "bg-warning-foreground/10",
  done: "",
  muted: "",
} as const satisfies Record<ThreadProgressTone, string>;

function ProgressSegments(props: {
  readonly segments: ReadonlyArray<{
    readonly id: string;
    readonly status: OrchestrationV2PlanStep["status"];
  }> | null;
  readonly fraction: number;
  readonly tone: ThreadProgressTone;
}) {
  const track = SEGMENT_TRACK_CLASSES[props.tone];
  const fill = SEGMENT_FILL_CLASSES[props.tone];
  if (props.segments === null) {
    return (
      <View className={cn("h-1.5 overflow-hidden rounded-full", track)}>
        <View
          className={cn("h-full rounded-full", fill)}
          style={{ width: `${Math.round(props.fraction * 100)}%` }}
        />
      </View>
    );
  }
  return (
    <View className="flex-row gap-1">
      {props.segments.map(({ id, status }) => (
        <View key={id} className={cn("h-1.5 flex-1 overflow-hidden rounded-full", track)}>
          {status === "completed" ? <View className={cn("h-full w-full", fill)} /> : null}
          {status === "running" ? <View className={cn("h-full w-[45%]", fill)} /> : null}
        </View>
      ))}
    </View>
  );
}

export function ThreadProgressSheet({
  open,
  onClose,
  steps,
  state,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly steps: ReadonlyArray<OrchestrationV2PlanStep>;
  readonly state: TodoRunState;
}) {
  const { height: windowHeight } = useWindowDimensions();
  const progress = presentThreadProgress(steps, state);
  const background = StyleSheet.flatten(useResolveClassNames("bg-screen"));
  return (
    <BottomSheet
      index={open ? 0 : -1}
      onClose={onClose}
      enablePanDownToClose
      backgroundStyle={background}
    >
      <BottomSheetView>
        <View className="px-5 pb-2">
          <View className="flex-row items-baseline justify-between">
            <Text accessibilityRole="header" className="text-2xl font-t3-bold text-foreground">
              Progress
            </Text>
            <Text className="text-sm tabular-nums text-foreground-muted">{progress.summary}</Text>
          </View>
          <View className="mt-3">
            <ProgressSegments
              segments={progress.segments}
              fraction={progress.fraction}
              tone={progress.tone}
            />
          </View>
        </View>
        <ScrollView
          style={{ maxHeight: windowHeight * 0.55 }}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 36, paddingTop: 6 }}
        >
          {steps.map((step) => {
            const row = presentThreadProgressStep(step, state);
            const tone = THREAD_PROGRESS_TONE_CLASSES[row.tone];
            return (
              <View
                key={step.id}
                accessibilityState={{ selected: step.status === "running" }}
                className={cn(
                  "flex-row items-center gap-3 rounded-2xl px-3 py-3",
                  row.highlight && ROW_TINT_CLASSES[row.tone],
                )}
              >
                <SymbolView
                  name={row.icon}
                  size={22}
                  tintColorClassName={tone.accent}
                  type="monochrome"
                  weight="medium"
                />
                <View className="min-w-0 flex-1">
                  <Text
                    className={cn(
                      "text-base",
                      row.highlight ? "font-t3-bold text-foreground" : "text-foreground-muted",
                      row.strike && "line-through",
                    )}
                  >
                    {step.text}
                  </Text>
                  {row.note ? (
                    <Text
                      className={cn(
                        "mt-0.5 text-xs font-t3-medium",
                        row.tone === "waiting" ? tone.text : "text-foreground-muted",
                      )}
                    >
                      {row.note}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </BottomSheetView>
    </BottomSheet>
  );
}
