import React, { useState } from "react";
import { RefreshControl } from "react-native";
import { api } from "@/src/api";
import { useLive } from "@/src/useLive";
import { TicketRow } from "@/src/cards";
import { EmptyState, ErrorState, LargeHeader, Screen, Section, Skeleton, TextButton } from "@/src/ui";

const NEEDS = ["payment_pending_approval", "self_fix_limit_pending", "reimbursement_pending_approval", "needs_landlord"];

export default function LandlordTickets() {
  const { data, error, loading, reload } = useLive<any[]>(() => api("/tickets"), 3000);
  const [showDone, setShowDone] = useState(false);
  const list = data || [];
  const needs = list.filter((t) => NEEDS.includes(t.status) || t.pending_approval);
  const done = list.filter((t) => ["closed", "cancelled"].includes(t.status));
  const prog = list.filter((t) => !needs.includes(t) && !done.includes(t));
  return (
    <Screen tab testID="landlord-tickets-screen" refresh={<RefreshControl refreshing={false} onRefresh={reload} />}>
      <LargeHeader title="Tickets" subtitle="Every repair across your homes" />
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading && !data ? <Skeleton /> : (
        <>
          <Section title="Needs you" testID="tickets-needs-section">
            {needs.length ? needs.map((t, i) => <TicketRow key={t.id} t={t} role="landlord" index={i} />) : <EmptyState testID="tickets-needs-empty" title="Nothing waiting on you" body="Tickets that need your tap show up here." />}
          </Section>
          <Section title="In progress" testID="tickets-progress-section">
            {prog.length ? prog.map((t, i) => <TicketRow key={t.id} t={t} role="landlord" index={i} />) : <EmptyState testID="tickets-progress-empty" title="No open repairs" body="When a tenant reports a problem, Rentwise opens a ticket and it appears here." />}
          </Section>
          <TextButton testID="tickets-done-toggle" label={`Done (${done.length}) ${showDone ? "⌄" : "›"}`} onPress={() => setShowDone(!showDone)} />
          {showDone ? done.map((t, i) => <TicketRow key={t.id} t={t} role="landlord" index={i} />) : null}
        </>
      )}
    </Screen>
  );
}
