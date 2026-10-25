import React from "react";
import { RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { api, ago } from "@/src/api";
import { HomeCard } from "@/src/homes";
import { useLive } from "@/src/useLive";
import { useAuth } from "@/src/auth";
import { ApprovalCard } from "@/src/cards";
import { BigButton, Card, ErrorState, Ionicons, LargeHeader, Row, Screen, Section, Skeleton, Txt } from "@/src/ui";
import { BigNumber, Countdown, More, Status, StripCard } from "@/src/visual";
import { when } from "@/src/status";
import { radius, spacing, useTheme } from "@/src/theme";

function Counter({ icon, n, label, testID }: { icon: string; n: string | number; label: string; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ flex: 1, alignItems: "center", gap: 2 }}>
      <Ionicons name={icon as any} size={20} color={colors.brandPrimary} />
      <Txt weight="bold" style={{ fontSize: 20 }}>{n}</Txt>
      <Txt v="caption" numberOfLines={1}>{label}</Txt>
    </View>
  );
}

export default function LandlordHome() {
  const { me } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();
  const { data, error, loading, reload } = useLive<any>(() => api("/landlord/home"), 3000);
  const ov = useLive<any>(() => api("/money/overview"), 10000);
  const mo = useLive<any[]>(() => api("/move-outs"), 10000);
  const s = data?.stats;
  const needs = data ? data.approvals.length + data.leases_to_sign.length : 0;
  const week = (data?.activity || []).filter((a: any) => Date.now() - new Date(a.created_at).getTime() < 7 * 86400000);
  const replies = week.filter((a: any) => a.kind === "agent").length;
  const repairs = new Set(week.filter((a: any) => a.ticket_id).map((a: any) => a.ticket_id)).size;
  return (
    <Screen tab testID="landlord-home-screen" refresh={<RefreshControl refreshing={false} onRefresh={() => { reload(); ov.reload(); }} />}>
      <LargeHeader title={`Hi ${me?.user?.name?.split(" ")[0] || ""} 👋`} actions={[{ label: "Settings", icon: "settings-outline", onPress: () => router.push("/settings"), testID: "home-settings-button" }]} />
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading && !data ? <Skeleton /> : data ? (
        <>
          {needs ? (
            <View testID="needs-you-banner" accessible accessibilityLabel={`${needs} need your OK`} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.youSoft, marginBottom: spacing.lg }}>
              <View style={{ minWidth: 36, height: 36, borderRadius: 18, backgroundColor: colors.you, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 }}>
                <Txt weight="bold" style={{ fontSize: 18 }} color={colors.onError}>{needs}</Txt>
              </View>
              <Txt v="label" color={colors.you} style={{ flex: 1 }}>Need your OK</Txt>
            </View>
          ) : (
            <StripCard kind="good" testID="needs-you-empty" style={{ marginBottom: spacing.lg }}><Status kind="good" label="All good. Homi is handling it." /></StripCard>
          )}
          <BigButton testID="ask-rentwise-button" tone="soft" icon="sparkles" label="Ask Homi" onPress={async () => { const t = await api("/threads/mine"); router.push(`/thread/${t.id}`); }} style={{ marginBottom: spacing.xl }} />
          {needs ? (
            <Section title="To do" testID="needs-you-section">
              {data.leases_to_sign.map((l: any) => (
                <StripCard key={l.id} kind="you" testID={`lease-sign-card-${l.id}`} onPress={() => router.push(`/lease/${l.id}`)} style={{ gap: spacing.sm }}>
                  <Row><Ionicons name="create" size={20} color={colors.you} /><Txt v="label" style={{ flex: 1 }}>{l.title.split(" — ")[0]}</Txt></Row>
                  <Status kind="you" label="Sign your part ›" size="sm" />
                </StripCard>
              ))}
              {data.approvals.map((a: any, i: number) => <ApprovalCard key={a.id} a={a} index={i} onDone={reload} />)}
            </Section>
          ) : null}
          <Section title="Money" testID="stats-section">
            <Card style={{ flexDirection: "row", gap: spacing.lg }}>
              <View style={{ flex: 1 }} testID="stat-collected"><BigNumber value={s.collected} sign={s.collected ? "in" : undefined} caption={`Collected · ${data.month}`} small /></View>
              <View style={{ flex: 1 }} testID="stat-overdue"><BigNumber value={s.overdue} color={s.overdue ? colors.you : colors.none} caption="Late" small /></View>
            </Card>
          </Section>
          {mo.data?.length ? (
            <Section title="Move-outs" testID="move-outs-section">
              {mo.data.map((m: any) => (
                <StripCard key={m.inspection_id} kind={m.statement_id ? "you" : m.days_left < 0 ? "you" : "waiting"} testID={`moveout-card-${m.inspection_id}`}
                  onPress={() => router.push(m.statement_id ? `/statement/${m.statement_id}` : `/inspection/${m.inspection_id}`)} style={{ gap: spacing.sm }}>
                  <Txt v="label" style={{ fontSize: 16 }}>{m.tenant_name.split(" ")[0]} · {m.unit_label}</Txt>
                  <Countdown days={m.days_left} total={m.return_days} caption={`Refund due ${when(m.due_by)}`} />
                  <Status size="sm" kind={m.statement_id ? "you" : "waiting"} label={m.statement_id ? "Needs your OK ›" : m.status === "analyzing" ? "Comparing photos" : "Waiting for tenant"} />
                </StripCard>
              ))}
            </Section>
          ) : null}
          <Section title="Homes" testID="homes-section">
            {(ov.data?.properties || []).map((p: any) => <HomeCard key={p.property.id} testID={`home-card-${p.property.id}`} p={p.property} units={p.units} onPress={() => router.push(`/property/${p.property.id}`)} />)}
          </Section>
          <Section title="Homi this week" testID="agent-feed-section">
            <Card>
              <Row testID="stat-fixed-without-you">
                <Counter testID="stat-open-tickets" icon="construct" n={repairs} label="repairs" />
                <Counter icon="chatbubbles" n={replies} label="replies" />
                <Counter testID="stat-avg-fix" icon="timer" n={`${Math.max(0, Math.round((replies * 5 + repairs * 30) / 60))} h`} label="saved" />
              </Row>
              {data.activity.length ? (
                <More label="What it did" testID="agent-feed-more">
                  {data.activity.slice(0, 12).map((a: any) => (
                    <Row key={a.id} style={{ alignItems: "center" }}>
                      <Ionicons name={a.kind === "agent" ? "sparkles" : a.kind === "money" ? "cash" : a.kind === "landlord" ? "person-circle" : "information-circle"} size={18} color={colors.brandPrimary} />
                      <Txt v="body" style={{ flex: 1 }} numberOfLines={2} testID={`activity-${a.id}`} onPress={a.ticket_id ? () => router.push(`/ticket/${a.ticket_id}`) : undefined}>{a.text}</Txt>
                      <Txt v="small">{ago(a.created_at)}</Txt>
                    </Row>
                  ))}
                </More>
              ) : null}
            </Card>
          </Section>
        </>
      ) : null}
    </Screen>
  );
}
