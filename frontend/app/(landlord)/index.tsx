import React from "react";
import { RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import Animated, { FadeInDown, LinearTransition } from "react-native-reanimated";
import { api, money, ago } from "@/src/api";
import { useLive } from "@/src/useLive";
import { useAuth } from "@/src/auth";
import { ApprovalCard } from "@/src/cards";
import { AgentMark, BigButton, Card, EmptyState, ErrorState, Ionicons, LargeHeader, Row, Screen, Section, Skeleton, Txt } from "@/src/ui";
import { spacing, useTheme } from "@/src/theme";

function Stat({ label, value, testID, tone }: { label: string; value: string; testID: string; tone?: string }) {
  return (
    <Card style={{ flex: 1, minWidth: 140 }} testID={testID}>
      <Txt v="caption">{label}</Txt>
      <Txt v="money" style={{ fontSize: 26 }} color={tone}>{value}</Txt>
    </Card>
  );
}

export default function LandlordHome() {
  const { me } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();
  const { data, error, loading, reload } = useLive<any>(() => api("/landlord/home"), 3000);
  const s = data?.stats;
  return (
    <Screen tab testID="landlord-home-screen" refresh={<RefreshControl refreshing={false} onRefresh={reload} />}>
      <LargeHeader title={`Hi ${me?.user?.name?.split(" ")[0] || ""}`} subtitle="Here's what needs you today"
        actions={[{ label: "Settings", icon: "settings-outline", onPress: () => router.push("/settings"), testID: "home-settings-button" }]} />
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      <BigButton testID="ask-rentwise-button" icon="sparkles" label="Ask Rentwise" onPress={async () => { const t = await api("/threads/mine"); router.push(`/thread/${t.id}`); }} style={{ marginBottom: spacing.xl }} />
      {loading && !data ? <Skeleton /> : data ? (
        <>
          <Section title="Needs you" testID="needs-you-section">
            {data.leases_to_sign.map((l: any) => (
              <Card key={l.id} agent testID={`lease-sign-card-${l.id}`} onPress={() => router.push(`/lease/${l.id}`)}>
                <Txt v="label" style={{ fontSize: 17 }}>{l.title}</Txt>
                <Txt v="small" color={colors.brandPrimary}>Open lease ›</Txt>
              </Card>
            ))}
            {data.approvals.map((a: any, i: number) => <ApprovalCard key={a.id} a={a} index={i} onDone={reload} />)}
            {!data.approvals.length && !data.leases_to_sign.length ? (
              <EmptyState testID="needs-you-empty" icon="checkmark-done-circle-outline" title="Nothing needs you" body="When Rentwise needs you to approve money or decide something, it appears here." />
            ) : null}
          </Section>
          <Section title="Stats" testID="stats-section">
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
              <Stat testID="stat-collected" label={`Collected in ${data.month}`} value={money(s.collected)} />
              <Stat testID="stat-overdue" label="Overdue" value={money(s.overdue)} tone={s.overdue ? colors.error : undefined} />
              <Stat testID="stat-open-tickets" label="Open tickets" value={String(s.open_tickets)} />
              <Card style={{ flex: 1, minWidth: 140 }} agent testID="stat-fixed-without-you">
                <AgentMark small />
                <Txt v="caption">Fixed without you</Txt>
                <Txt v="money" style={{ fontSize: 26 }}>{s.fixed_without_you}</Txt>
                <Txt v="small">{s.taps ? `${s.taps} taps total` : ""}{s.avg_hours ? ` · avg ${s.avg_hours} h` : ""}</Txt>
              </Card>
            </View>
          </Section>
          <Section title="Agent at work" testID="agent-feed-section">
            {data.activity.length ? (
              <Card agent style={{ paddingVertical: spacing.sm }}>
                {data.activity.map((a: any) => (
                  <Animated.View key={a.id} entering={FadeInDown.duration(260)} layout={LinearTransition}>
                    <Row style={{ paddingVertical: spacing.sm, alignItems: "flex-start" }}>
                      <Ionicons name={a.kind === "agent" ? "sparkles" : a.kind === "money" ? "cash-outline" : a.kind === "landlord" ? "person-circle-outline" : "information-circle-outline"} size={18} color={colors.brandPrimary} style={{ marginTop: 2 }} />
                      <View style={{ flex: 1 }}>
                        <Txt v="body" testID={`activity-${a.id}`} onPress={a.ticket_id ? () => router.push(`/ticket/${a.ticket_id}`) : undefined}>{a.text}</Txt>
                        <Txt v="small">{ago(a.created_at)}{a.ticket_id ? " · Open ticket ›" : ""}</Txt>
                      </View>
                    </Row>
                  </Animated.View>
                ))}
              </Card>
            ) : <EmptyState testID="agent-feed-empty" title="Quiet so far" body="Everything Rentwise does for you shows up here as it happens." />}
          </Section>
        </>
      ) : null}
    </Screen>
  );
}
