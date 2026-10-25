import React from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { api, ago, money } from "@/src/api";
import { useLive } from "@/src/useLive";
import { useAuth } from "@/src/auth";
import { BigButton, Card, EmptyState, ErrorState, FileImage, Ionicons, LargeHeader, Row, Screen, Section, Skeleton, TextButton, Txt, useToast } from "@/src/ui";
import { BigNumber, Countdown, Status, StripCard, fmtSlot, tradeIcon } from "@/src/visual";
import { spacing, useTheme } from "@/src/theme";

const daysTo = (iso?: string) => (iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000) : 0);

function OfferCard({ t, index }: { t: any; index: number }) {
  const router = useRouter();
  const { colors } = useTheme();
  const age = ago(t.created_at);
  return (
    <StripCard kind="you" index={index} testID={`ticket-row-${t.id}`} style={{ gap: spacing.md }}>
      {t.missed_call ? <Row testID={`missed-call-${t.id}`}><Ionicons name="call" size={18} color={colors.you} /><Txt v="label" color={colors.you}>Missed call from Homi</Txt></Row> : null}
      <Row><Ionicons name={tradeIcon(t.trade) as any} size={20} color={colors.you} /><Txt v="h2" style={{ flex: 1 }} numberOfLines={1}>{t.title} · {t.city}</Txt></Row>
      <BigNumber value={t.urgency === "emergency" ? "Now" : age === "just now" || age.includes("min") || age.includes(" h ") ? "Today" : age} caption={t.urgency === "emergency" ? "Emergency" : "New"} small />
      {t.photos?.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>{t.photos.map((p: string) => <FileImage key={p} id={p} size={96} />)}</ScrollView> : null}
      <Status testID={`ticket-status-${t.id}`} kind="you" label="New job" size="sm" />
      <BigButton testID={`offer-take-${t.id}`} icon="checkmark-circle" label="Take job" onPress={() => router.push(`/ticket/${t.id}`)} />
      <TextButton testID={`offer-cant-${t.id}`} label="Can't" color={colors.you} onPress={() => router.push(`/ticket/${t.id}`)} />
    </StripCard>
  );
}

function BookedCard({ t, index }: { t: any; index: number }) {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <StripCard kind="waiting" index={index} testID={`ticket-row-${t.id}`} onPress={() => router.push(`/ticket/${t.id}`)} style={{ gap: spacing.sm }}>
      <Row><Ionicons name={tradeIcon(t.trade) as any} size={20} color={colors.brandPrimary} /><Txt v="label" style={{ flex: 1 }} numberOfLines={1}>{t.title}</Txt></Row>
      {t.picked_slot ? <Countdown days={Math.max(0, daysTo(t.picked_slot.iso))} total={7} caption={fmtSlot(t.picked_slot)} /> : null}
      {t.address ? <Row><Ionicons name="location" size={20} color={colors.brandPrimary} /><Txt v="body" style={{ flex: 1 }}>{t.address}</Txt></Row> : null}
      <Status testID={`ticket-status-${t.id}`} kind="waiting" label={t.status === "booked" ? "Booked" : "Waiting on tenant"} size="sm" />
    </StripCard>
  );
}

function DoneCard({ t, index }: { t: any; index: number }) {
  const router = useRouter();
  const paid = t.status === "closed";
  return (
    <StripCard kind={paid ? "good" : "waiting"} index={index} testID={`ticket-row-${t.id}`} onPress={() => router.push(`/ticket/${t.id}`)} style={{ gap: spacing.sm }}>
      <Txt v="label" numberOfLines={1}>{t.title}</Txt>
      <Status testID={`ticket-status-${t.id}`} kind={paid ? "good" : "waiting"} label={paid ? `${money(t.final_amount || t.quote)} paid` : "Payment on the way"} />
    </StripCard>
  );
}

export default function Jobs() {
  const { me, refresh } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useLive<any>(() => api("/handyman/jobs"), 3000);
  const invites = (me?.invites || []).filter((i: any) => i.kind === "handyman");
  return (
    <Screen tab testID="handyman-jobs-screen" refresh={<RefreshControl refreshing={false} onRefresh={() => { reload(); refresh(); }} />}>
      <LargeHeader title={`Hi ${me?.user?.name?.split(" ")[0] || ""} 👋`} />
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {invites.map((i: any) => (
        <Card key={i.id} agent testID={`hm-invite-${i.id}`} style={{ marginBottom: spacing.md }}>
          <Txt v="label">{i.text}</Txt><Txt v="small" style={{ marginBottom: spacing.sm }}>{i.sub}</Txt>
          <BigButton testID={`hm-invite-accept-${i.id}`} label="Accept" onPress={async () => { try { await api(`/invites/${i.id}/accept`, { method: "POST" }); toast("Joined"); refresh(); } catch (e: any) { toast(e.message, "error"); } }} />
        </Card>
      ))}
      {loading && !data ? <Skeleton /> : data ? (
        <>
          <Section title="New jobs" testID="offers-section">
            {data.offers.length ? data.offers.map((t: any, i: number) => <OfferCard key={t.id} t={t} index={i} />) : <EmptyState testID="offers-empty" icon="notifications-outline" title="No new jobs" />}
          </Section>
          <Section title="Booked" testID="booked-section">
            {data.booked.length ? data.booked.map((t: any, i: number) => <BookedCard key={t.id} t={t} index={i} />) : <Status kind="none" label="Nothing booked" size="sm" />}
          </Section>
          <Section title="Done" testID="done-section">
            {data.done.length ? data.done.map((t: any, i: number) => <DoneCard key={t.id} t={t} index={i} />) : <Status kind="none" label="No jobs yet" size="sm" />}
          </Section>
          <Section title={`Missed (${data.missed?.length || 0})`} testID="missed-section">
            {data.missed?.length ? data.missed.map((m: any, i: number) => (
              <StripCard key={m.id} kind="none" index={i} testID={`missed-job-${m.id}`} style={{ gap: 4 }}>
                <Txt v="label">{m.title} · {m.city}</Txt>
                <Status size="sm" kind="none" label={m.reason === "expired" ? `Missed · ${ago(m.at)}` : `You said no · ${ago(m.at)}`} />
              </StripCard>
            )) : <Status kind="none" label="None" size="sm" />}
          </Section>
          <View style={{ height: spacing.lg }} />
        </>
      ) : null}
    </Screen>
  );
}
