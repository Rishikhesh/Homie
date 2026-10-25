// Static product preview for the sign-in screen: a few real-looking Doorman cards stacked with depth.
import React from "react";
import { View } from "react-native";
import { Ionicons, Txt } from "@/src/ui";
import { radius, useTheme } from "@/src/theme";

const W = 340; // design canvas, scaled to fit the space the login screen gives us

export function LoginHero({ size = 320 }: { size?: number }) {
  const { colors } = useTheme();
  const card = {
    position: "absolute" as const, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: 14,
    borderWidth: 0.5, borderColor: colors.border, shadowColor: colors.shadow, shadowOpacity: 0.1, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 6,
  };
  const pill = (bg: string, fg: string, icon: any, label: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
      <Ionicons name={icon} size={11} color={fg} />
      <Txt v="small" color={fg} style={{ fontSize: 11, lineHeight: 14 }}>{label}</Txt>
    </View>
  );
  return (
    <View testID="login-hero" style={{ width: size, height: size }}>
      <View style={{ width: W, height: W, transform: [{ scale: size / W }], position: "absolute", left: (size - W) / 2, top: (size - W) / 2 }}>
        {/* property + rent */}
        <View style={[card, { top: 14, left: 0, width: 252 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="home" size={17} color={colors.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt v="label" numberOfLines={1}>Maple House</Txt>
              <Txt v="small" numberOfLines={1} style={{ fontSize: 11 }}>San Jose · 2 rooms</Txt>
            </View>
            {pill(colors.goodSoft, colors.good, "checkmark-circle", "All paid")}
          </View>
          <Txt v="small" style={{ marginTop: 12, fontSize: 11 }}>October rent</Txt>
          <Txt v="h2" style={{ fontSize: 26, lineHeight: 32 }}>$3,200</Txt>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceTertiary, marginTop: 6, overflow: "hidden" }}>
            <View style={{ width: "100%", height: 6, backgroundColor: colors.good, borderRadius: 3 }} />
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
            <Txt v="small" style={{ fontSize: 11 }}>Room A · Tom</Txt>
            <Txt v="small" style={{ fontSize: 11 }}>Room B · Maria</Txt>
          </View>
        </View>

        {/* agent update */}
        <View style={[card, { top: 136, right: 0, width: 272 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="sparkles" size={13} color={colors.onBrandPrimary} />
            </View>
            <Txt v="label" style={{ flex: 1 }}>Doorman</Txt>
            <Txt v="small" style={{ fontSize: 11 }}>just now</Txt>
          </View>
          <Txt v="body" style={{ marginTop: 8, fontSize: 14, lineHeight: 19 }}>Hank fixes the sink Thu 3 pm for $150. Under your auto-OK, no tap needed.</Txt>
          <View style={{ flexDirection: "row", gap: 6, marginTop: 10 }}>
            {pill(colors.goodSoft, colors.good, "calendar", "Booked")}
            {pill(colors.brandSecondary, colors.onBrandSecondary, "flash", "Auto-OK")}
          </View>
        </View>

        {/* payment toast */}
        <View style={[card, { top: 266, left: 12, width: 236, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10 }]}>
          <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.goodSoft, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="arrow-down" size={15} color={colors.good} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt v="label" numberOfLines={1} style={{ fontSize: 13 }}>Tom paid $1,600</Txt>
            <Txt v="small" numberOfLines={1} style={{ fontSize: 11 }}>Bank transfer · in your books</Txt>
          </View>
        </View>
      </View>
    </View>
  );
}
