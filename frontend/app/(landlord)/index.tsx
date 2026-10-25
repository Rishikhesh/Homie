import React from "react";
import { RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import Animated, { FadeInDown, LinearTransition } from "react-native-reanimated";
import { api, money, ago } from "@/src/api";
import { useLive } from "@/src/useLive";
import { useAuth } from "@/src/auth";
import { ApprovalCard } from "@/src/cards";
import { BigButton, Card, EmptyState, ErrorState, Ionicons, LargeHeader, Row, Screen, Section, Skeleton, Txt } from "@/src/ui";
import { spacing, useTheme } from "@/src/theme";

function Stat({ label, value, testID, tone }: { label: string; value: string; testID: string; tone?: string }) {
  return (
    <View style={{ flex: 1, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, gap: 2 }} testID={testID}>
      <Txt v="caption" numberOfLines={1}>{label}</Txt>
      <Txt v="money" style={{ fontSize: 24 }} color={tone} numberOfLines={1} adjustsFontSizeToFit>{value}</Txt>
    </View>
  );
}

function StatsBlock({ s, month }: { s: any; month: string }) {
  const { colors } = useTheme();
  const line = { backgroundColor: colors.divider };
  return (
    <View style={{ gap: spacing.md }}>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <View style={{ flexDirection: "row" }}>
          <Stat testID="stat-collected" label={`Collected · ${month}`} value={money(s.collected)} />
          <View style={[{ width: 0.5 }, line]} />
          <Stat testID="stat-overdue" label="Overdue" value={money(s.overdue)} tone={s.overdue ? colors.error : undefined} />
        </View>
        <View style={[{ height: 0.5 }, line]} />
        <View style={{ flexDirection: "row" }}>
          <Stat testID="stat-open-tickets" label="Open tickets" value={String(s.open_tickets)} />
          <View style={[{ width: 0.5 }, line]} />
          <Stat testID="stat-avg-fix" label="Avg time to fix" value={s.avg_hours ? `${Math.round(s.avg_hours)} h` : "—"} />
        </View>
      </Card>
      <Card agent testID="stat-fixed-without-you" style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="sparkles" size={20} color={colors.onBrandSecondary} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt v="label">Fixed without you</Txt>
          <Txt v="small">{s.taps ? `You only tapped ${s.taps} times to approve money` : "Repairs Rentwise closes on its own"}</Txt>
        </View>
        <Txt v="money" style={{ fontSize: 28 }}>{s.fixed_without_you}</Txt>
      </Card>
    </View>
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
            <StatsBlock s={s} month={data.month} />
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
