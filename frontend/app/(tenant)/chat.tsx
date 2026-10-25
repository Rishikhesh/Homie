import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api";
import { Chat } from "@/src/chat";
import { AgentMark, ErrorState, Skeleton, Txt } from "@/src/ui";
import { usesNativeTabs } from "@/src/navigation";
import { spacing, useTheme } from "@/src/theme";

export default function TenantChat() {
  const ins = useSafeAreaInsets();
  const { colors } = useTheme();
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [tid, setTid] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api("/threads/mine").then((t) => setTid(t.id)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  return (
    <View testID="tenant-chat-screen" style={{ flex: 1, backgroundColor: colors.surface, paddingTop: ins.top }}>
      <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
        <Txt v="title" style={{ fontSize: 28 }}>Chat</Txt>
        <AgentMark />
      </View>
      {err ? <View style={{ padding: spacing.lg }}><ErrorState message={err} onRetry={load} /></View> : null}
      {tid ? <Chat threadId={tid} bottomPad={usesNativeTabs ? ins.bottom : 0} quickReplies={[...(q ? [q] : []), "Report a problem", "When is rent due?", "Ask about my lease", "My rights"].filter((v, i, a) => a.indexOf(v) === i)} /> : !err ? <View style={{ padding: spacing.lg }}><Skeleton /></View> : null}
    </View>
  );
}
