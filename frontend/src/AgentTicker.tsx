// "Homi at work": a live-looking feed of tasks the agent finishes for a rental — working… → done ✓, one after another.
import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import Animated, { FadeInDown, FadeOutUp, useReducedMotion } from "react-native-reanimated";
import { Ionicons, Txt } from "@/src/ui";
import { radius, spacing, useTheme } from "@/src/theme";

const TASKS = [
  { icon: "water", work: "Finding a plumber…", done: "Hank booked · Thu 3 pm" },
  { icon: "cash", work: "Checking rent…", done: "Rent in · $1,200" },
  { icon: "chatbubbles", work: "Answering Maria…", done: "Replied in 8 sec" },
  { icon: "flame", work: "Gas smell! Acting…", done: "Safe · plumber coming" },
  { icon: "document-text", work: "Preparing lease…", done: "Lease signed" },
];

export function AgentTicker() {
  const { colors } = useTheme();
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const a = setTimeout(() => setDone(true), reduce ? 0 : 1100);
    const b = setTimeout(() => { setDone(false); setI((x) => (x + 1) % TASKS.length); }, 3000);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [i, reduce]);
  const t = TASKS[i];
  return (
    <View testID="agent-ticker" accessibilityLiveRegion="polite" style={{ height: 64, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary, borderWidth: 0.5, borderColor: colors.border, overflow: "hidden", justifyContent: "center" }}>
      <Animated.View key={i} entering={reduce ? undefined : FadeInDown.duration(350)} exiting={reduce ? undefined : FadeOutUp.duration(250)}
        style={{ position: "absolute", left: 0, right: 0, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: done ? colors.goodSoft : colors.brandTertiary, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={t.icon as any} size={19} color={done ? colors.good : colors.brandPrimary} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt v="caption" style={{ fontSize: 12 }}>HOMI · {done ? "DONE" : "WORKING"}</Txt>
          <Txt v="label" numberOfLines={1} style={{ flexShrink: 1 }}>{done ? t.done : t.work}</Txt>
        </View>
        {done ? <Ionicons testID="agent-ticker-done" name="checkmark-circle" size={22} color={colors.good} /> : <ActivityIndicator size="small" color={colors.brandPrimary} />}
      </Animated.View>
    </View>
  );
}
