// Two big choice cards (no toggles). Used for "how Rentwise reaches you" and the landlord's "Call handymen".
import React from "react";
import { Pressable, View } from "react-native";
import { Ionicons, Txt } from "@/src/ui";
import { radius, spacing, useTheme } from "@/src/theme";

export type Choice = { value: string; icon: string; title: string; body: string };

export function ChoiceCards({ choices, value, onChange, testIDPrefix }: { choices: Choice[]; value: string; onChange: (v: string) => void; testIDPrefix: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      {choices.map((c) => {
        const on = c.value === value;
        return (
          <Pressable key={c.value} testID={`${testIDPrefix}-${c.value}`} accessibilityRole="radio" accessibilityState={{ checked: on, selected: on }} accessibilityLabel={`${c.title}${on ? ", selected" : ""}`} onPress={() => onChange(c.value)}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 2,
              borderColor: on ? colors.brandPrimary : colors.border, backgroundColor: on ? colors.brandTertiary : colors.surfaceSecondary, opacity: pressed ? 0.85 : 1 })}>
            <Ionicons name={c.icon as any} size={24} color={colors.brandPrimary} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt v="label" style={{ fontSize: 16 }}>{c.title}</Txt>
              <Txt v="small">{c.body}</Txt>
            </View>
            <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={22} color={on ? colors.brandPrimary : colors.muted} />
          </Pressable>
        );
      })}
    </View>
  );
}

export const CONTACT_CHOICES: Choice[] = [
  { value: "call", icon: "call", title: "Call me", body: "Your phone rings in the app. Quickest way to get jobs." },
  { value: "message", icon: "chatbubble-ellipses", title: "Message me", body: "You get a message with the job details." },
];
