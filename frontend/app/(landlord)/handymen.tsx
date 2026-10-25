import React, { useState } from "react";
import { RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { useLive } from "@/src/useLive";
import { Avatar, BigButton, Card, Chip, ChipRow, EmptyState, ErrorState, Field, LargeHeader, Row, Screen, Section, Sheet, Skeleton, StatusPill, TextButton, Txt, useToast } from "@/src/ui";
import { TRADES, tradeLabel } from "@/src/constants";
import { spacing, useTheme } from "@/src/theme";

export function HmCard({ h, index, right, onPress }: any) {
  const { colors } = useTheme();
  return (
    <Card index={index} testID={`handyman-card-${h.user_id}`} onPress={onPress}>
      <Row>
        <Avatar name={h.name} size={46} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt v="label" style={{ fontSize: 17 }}>{h.name}</Txt>
          <Txt v="small">{(h.trades || []).join(", ")} · {h.city}</Txt>
          <Txt v="small" color={colors.onSurface}>★ {h.rating_avg?.toFixed?.(1) || "New"}{h.jobs_for_you != null ? ` · ${h.jobs_for_you} jobs for you` : ` · ${h.jobs_done || 0} ${h.jobs_done === 1 ? "job" : "jobs"}`}</Txt>
          {h.last_job ? <Txt v="small">Last: {h.last_job}</Txt> : null}
        </View>
        {right}
      </Row>
    </Card>
  );
}

export default function Handymen() {
  const router = useRouter();
  const toast = useToast();
  const [trade, setTrade] = useState<string | null>(null);
  const [invite, setInvite] = useState(false);
  const [email, setEmail] = useState("");
  const mine = useLive<any>(() => api("/handymen/mine"), 0);
  const market = useLive<any[]>(() => api(`/handymen/market${trade ? `?trade=${trade}` : ""}`), 0, [trade]);
  const reload = () => { mine.reload(); market.reload(); };
  return (
    <Screen tab testID="handymen-screen" refresh={<RefreshControl refreshing={false} onRefresh={reload} />}>
      <LargeHeader title="Handymen" subtitle="Your people, across all homes" actions={[{ label: "Invite", icon: "person-add-outline", onPress: () => setInvite(true), testID: "invite-handyman-button" }]} />
      {mine.error ? <ErrorState message={mine.error} onRetry={reload} /> : null}
      <Section title="My handymen" testID="my-handymen-section">
        {mine.loading && !mine.data ? <Skeleton count={1} /> : (
          <>
            {(mine.data?.handymen || []).map((h: any, i: number) => <HmCard key={h.user_id} h={h} index={i} onPress={() => router.push(`/handyman/${h.user_id}`)} />)}
            {(mine.data?.invites || []).map((i: any) => <Card key={i.id} testID={`handyman-invite-${i.id}`}><Txt v="label">{i.email}</Txt><StatusPill label="Invite pending" tone="warning" /></Card>)}
            {mine.data && !mine.data.handymen.length ? <EmptyState testID="my-handymen-empty" icon="construct-outline" title="No handymen yet" body="Rentwise asks your own handymen first. Invite someone you trust or add one from below." action="Invite a handyman" onAction={() => setInvite(true)} /> : null}
          </>
        )}
      </Section>
      <Section title="Find more" testID="market-section">
        <ChipRow>
          <Chip testID="market-trade-all" label="All" selected={!trade} onPress={() => setTrade(null)} />
          {TRADES.map((t) => <Chip key={t} testID={`market-trade-${t}`} label={tradeLabel(t)} selected={trade === t} onPress={() => setTrade(t)} />)}
        </ChipRow>
        {(market.data || []).map((h, i) => (
          <HmCard key={h.user_id} h={h} index={i} onPress={() => router.push(`/handyman/${h.user_id}`)}
            right={<TextButton testID={`market-add-${h.user_id}`} label="Add" icon="add-circle-outline" onPress={async () => { try { await api(`/handymen/${h.user_id}/add`, { method: "POST" }); toast(`${h.name} added to your list`); reload(); } catch (e: any) { toast(e.message, "error"); } }} />} />
        ))}
        {market.data && !market.data.length ? <EmptyState testID="market-empty" title="No one listed nearby yet" body="Handymen in your properties' states appear here when they join Rentwise." /> : null}
      </Section>
      <Sheet visible={invite} onClose={() => setInvite(false)} title="Invite a handyman" testID="invite-handyman-sheet">
        <Field testID="invite-handyman-email" label="Their Google email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} hint="They'll see your invite when they sign in to Rentwise. No email is sent." />
        <BigButton testID="invite-handyman-send" style={{ marginTop: spacing.lg }} label="Send invite" onPress={async () => { try { await api("/handymen/invite", { body: { email } }); toast("Invite created"); setInvite(false); setEmail(""); reload(); } catch (e: any) { toast(e.message, "error"); } }} />
      </Sheet>
    </Screen>
  );
}
