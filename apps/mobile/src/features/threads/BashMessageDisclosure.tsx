import {
  composerBashStatusLabel,
  type ComposerBashCommand,
} from "@t3tools/client-runtime/composer-bash";
import type { ReactNode } from "react";
import { Pressable, ScrollView, View, type ColorValue } from "react-native";
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
    <View
      className={cn(
        "min-w-0 gap-2 rounded-xl",
        command.status === "completed" && "shadow-2xl shadow-danger-foreground/20",
      )}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={composerBashStatusLabel(command)}
        accessibilityState={{ expanded }}
        onPress={onToggle}
        className="min-h-11 flex-row items-center justify-between gap-2"
      >
        <Text className="shrink text-xs text-foreground-secondary">
          {composerBashStatusLabel(command)}
        </Text>
        <ThreadDisclosureChevron
          expanded={expanded}
          collapsedDirection="down"
          size={14}
          tintColor={chevronColor}
        />
      </Pressable>
      {children}
      {expanded && (
        <ScrollView nestedScrollEnabled style={{ maxHeight: 320 }}>
          <Text selectable className="font-mono text-xs text-user-bubble-foreground">
            {command.output ||
              (command.status === "running" ? "Running command…" : "No command output.")}
          </Text>
        </ScrollView>
      )}
    </View>
  );
}
