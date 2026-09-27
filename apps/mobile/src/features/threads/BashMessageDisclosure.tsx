import {
  composerBashStatusLabel,
  parseComposerBashOutput,
  type ComposerBashCommand,
} from "@t3tools/client-runtime/composer-bash";
import type { ReactNode } from "react";
import { Pressable, ScrollView, View, type ColorValue } from "react-native";
import Animated, { FadeIn, FadeInUp, FadeOut, ReduceMotion } from "react-native-reanimated";
import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { ThreadDisclosureChevron } from "./thread-work-log";

export function BashMessageDisclosure({
  command,
  expanded,
  onToggle,
  children,
  chevronColor,
}: {
  command: ComposerBashCommand | undefined;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  chevronColor: ColorValue;
}) {
  if (!command) return children;

  return (
    <View className="min-w-0 gap-2 rounded-xl">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={composerBashStatusLabel(command)}
        accessibilityState={{ expanded }}
        onPress={onToggle}
        className="min-h-11 flex-row items-center justify-between gap-2"
      >
        <Animated.View key={command.status} entering={FadeIn.duration(200)} className="shrink">
          <Text
            className={cn(
              "shrink font-t3-medium text-xs",
              command.status === "failed" ? "text-danger-foreground" : "text-foreground-secondary",
            )}
          >
            {composerBashStatusLabel(command)}
          </Text>
        </Animated.View>
        <ThreadDisclosureChevron
          expanded={expanded}
          collapsedDirection="down"
          size={14}
          tintColor={chevronColor}
        />
      </Pressable>
      {children}
      {expanded && (
        <Animated.View
          entering={FadeInUp.duration(220).reduceMotion(ReduceMotion.System)}
          exiting={FadeOut.duration(140)}
        >
          <BashOutput command={command} />
        </Animated.View>
      )}
    </View>
  );
}

function BashOutput({ command }: { command: ComposerBashCommand }) {
  if (!command.output) {
    return (
      <Text className="text-xs text-foreground-secondary">
        {command.status === "running" ? "Running command…" : "No command output."}
      </Text>
    );
  }
  const { exitCode, stdout, stderr } = parseComposerBashOutput(command.output);
  return (
    <View className="gap-1">
      <ScrollView nestedScrollEnabled style={{ maxHeight: 320 }}>
        <Text selectable className="font-mono text-xs text-user-bubble-foreground">
          {stdout}
          {stdout && stderr ? "\n" : null}
          {stderr ? (
            <Text className="font-mono text-xs text-danger-foreground">{stderr}</Text>
          ) : null}
          {!stdout && !stderr ? "No output" : null}
        </Text>
      </ScrollView>
      {exitCode !== null && (
        <Text className="self-end font-mono text-2xs text-foreground-secondary">
          exit {exitCode}
        </Text>
      )}
    </View>
  );
}
