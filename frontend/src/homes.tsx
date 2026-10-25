import React from "react";
import { Pressable, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { propertyPhoto } from "@/src/api";
import { Ionicons, Txt } from "@/src/ui";
import { KIND_ICON, kindColor, statusOf } from "@/src/status";
import { radius, spacing, useTheme } from "@/src/theme";

/** Room A ✓ Paid · Room B ⏳ Due · Room C ○ Empty */
export function RoomStrip({ units, testID }: { units: any[]; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {units.map((u: any) => {
        const st = u.tenant_name ? statusOf(u.month ? { ...u.month, status: u.overdue ? "overdue" : u.month.status, due_day: u.unit.due_day } : null, "landlord", "rent") : { kind: "none" as const, label: "Empty" };
        return (
          <View key={u.unit.id} testID={`room-status-${u.unit.id}`} accessible accessibilityLabel={`${u.unit.label}, ${st.label}`}
            style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary }}>
            <Ionicons name={KIND_ICON[st.kind] as any} size={16} color={kindColor(colors, st.kind)} />
            <Txt weight="semibold" style={{ fontSize: 14 }}>{u.unit.label.replace("Whole home", "Home")} · {st.label}</Txt>
          </View>
        );
      })}
    </View>
  );
}

export function HomeCard({ p, units, onPress, testID }: { p: any; units: any[]; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => ({ borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.surfaceTertiary, opacity: pressed ? 0.9 : 1 })}>
      <View style={{ height: 130 }}>
        <Image source={{ uri: propertyPhoto(p.photo, p.id) }} style={{ position: "absolute", width: "100%", height: "100%" }} contentFit="cover" />
        <LinearGradient colors={["transparent", "rgba(0,0,0,0.7)"]} style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 90 }} />
        <Txt v="h2" color="#FFFFFF" style={{ position: "absolute", left: spacing.lg, bottom: spacing.md }}>{p.name}</Txt>
      </View>
      <View style={{ padding: spacing.md }}><RoomStrip units={units} /></View>
    </Pressable>
  );
}

