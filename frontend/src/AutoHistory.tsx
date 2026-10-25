// Landlord's list of repairs OK'd automatically under the auto-OK limit.
import React from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { useLive } from "@/src/useLive";
import { Card, Divider, Ionicons, Row, Skeleton, Txt } from "@/src/ui";
import { useTheme } from "@/src/theme";

const usd = (n: number) => `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const day = (s: string) => new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function AutoHistory() {
  const router = useRouter();
  const { colors } = useTheme();
  const { data } = useLive<any>(() => api("/landlord/auto-approvals"), 15000);
  if (!data) return <Skeleton />;
  return (
    <View testID="auto-history" style={{ gap: 8 }}>
      <Row style={{ justifyContent: "space-between" }}>
        <Txt v="label">Auto-OK’d repairs</Txt>
        {data.count ? <Txt testID="auto-history-total" v="label" color={colors.brandPrimary}>{data.count} {data.count === 1 ? "repair" : "repairs"} · {usd(data.total)} total</Txt> : null}
      </Row>
      <Card>
        {data.items.map((i: any, idx: number) => (
          <View key={i.id}>
            {idx ? <Divider /> : null}
            <Pressable testID={`auto-history-row-${i.ticket_id}`} onPress={() => router.push(`/ticket/${i.ticket_id}`)} style={{ minHeight: 44, justifyContent: "center" }}>
              <Row>
                <View style={{ flex: 1 }}>
                  <Txt v="body" numberOfLines={1}>{i.title}</Txt>
                  <Txt v="small">{[i.handyman, day(i.at)].filter(Boolean).join(" · ")}</Txt>
                </View>
                <Txt v="label">{usd(i.amount)}</Txt>
                <Ionicons name="chevron-forward" size={16} color={colors.muted} />
              </Row>
            </Pressable>
          </View>
        ))}
        {!data.items.length ? <Txt v="small">Nothing yet. Repairs OK’d under your limit will show here with their price.</Txt> : null}
      </Card>
    </View>
  );
}
