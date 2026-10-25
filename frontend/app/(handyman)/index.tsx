import React from "react";
import { RefreshControl } from "react-native";
import { api } from "@/src/api";
import { useLive } from "@/src/useLive";
import { useAuth } from "@/src/auth";
import { TicketRow } from "@/src/cards";
import { BigButton, Card, EmptyState, ErrorState, LargeHeader, Screen, Section, Skeleton, Txt, useToast } from "@/src/ui";
import { spacing } from "@/src/theme";

export default function Jobs() {
  const { me, refresh } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useLive<any>(() => api("/handyman/jobs"), 3000);
  const invites = (me?.invites || []).filter((i: any) => i.kind === "handyman");
  return (
    <Screen tab testID="handyman-jobs-screen" refresh={<RefreshControl refreshing={false} onRefresh={() => { reload(); refresh(); }} />}>
      <LargeHeader title="Jobs" subtitle={`Hi ${me?.user?.name?.split(" ")[0] || ""}`} />
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {invites.map((i: any) => (
        <Card key={i.id} agent testID={`hm-invite-${i.id}`} style={{ marginBottom: spacing.md }}>
          <Txt v="label">{i.text}</Txt><Txt v="small" style={{ marginBottom: spacing.sm }}>{i.sub}</Txt>
          <BigButton testID={`hm-invite-accept-${i.id}`} label="Accept" onPress={async () => { try { await api(`/invites/${i.id}/accept`, { method: "POST" }); toast("Joined"); refresh(); } catch (e: any) { toast(e.message, "error"); } }} />
        </Card>
      ))}
      {loading && !data ? <Skeleton /> : data ? (
        <>
          <Section title="New offers" testID="offers-section">
            {data.offers.length ? data.offers.map((t: any, i: number) => <TicketRow key={t.id} t={t} role="handyman" index={i} />) : <EmptyState testID="offers-empty" icon="notifications-outline" title="No new offers" body="When a landlord's tenant needs your trade, the job appears here with photos and the city." />}
          </Section>
          <Section title="Booked" testID="booked-section">
            {data.booked.length ? data.booked.map((t: any, i: number) => <TicketRow key={t.id} t={t} role="handyman" index={i} />) : <Txt v="small">Nothing booked yet.</Txt>}
          </Section>
          <Section title="Done / paid" testID="done-section">
            {data.done.length ? data.done.map((t: any, i: number) => <TicketRow key={t.id} t={t} role="handyman" index={i} />) : <Txt v="small">Finished jobs show here.</Txt>}
          </Section>
        </>
      ) : null}
    </Screen>
  );
}
