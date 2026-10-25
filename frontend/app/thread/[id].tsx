import React from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api";
import { useLive } from "@/src/useLive";
import { Chat } from "@/src/chat";
import { Ionicons, TextButton, Txt } from "@/src/ui";
import { spacing, useTheme } from "@/src/theme";

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const ins = useSafeAreaInsets();
  const { colors } = useTheme();
  const { data } = useLive<any>(() => api(`/threads/${id}?after=9999`), 0, [id]);
  const kind = data?.thread?.kind;
  return (
    <View testID="thread-screen" style={{ flex: 1, backgroundColor: colors.surface, paddingTop: ins.top }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm, paddingBottom: spacing.sm, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
        <TextButton testID="thread-back-button" icon="chevron-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="sparkles" size={16} color={colors.brandPrimary} />
          <Txt v="label" numberOfLines={1} style={{ flex: 1 }}>{data?.title || "Doorman"}</Txt>
        </View>
      </View>
      <Chat threadId={id!} bottomPad={ins.bottom} quickReplies={kind === "landlord" ? ["Who's late?", "What did I spend on repairs?", "Prefer Hank for plumbing"] : []} />
    </View>
  );
}
