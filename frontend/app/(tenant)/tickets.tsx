import React, { useState } from "react";
import { RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { useLive } from "@/src/useLive";
import { TicketRow } from "@/src/cards";
import { EmptyState, ErrorState, LargeHeader, Screen, Section, Skeleton, TextButton } from "@/src/ui";

export default function TenantTickets() {
  const router = useRouter();
  const { data, error, loading, reload } = useLive<any[]>(() => api("/tickets"), 3000);
  const [showDone, setShowDone] = useState(false);
  const open = (data || []).filter((t) => !["closed", "cancelled"].includes(t.status));
  const done = (data || []).filter((t) => ["closed", "cancelled"].includes(t.status));
  return (
    <Screen tab testID="tenant-tickets-screen" refresh={<RefreshControl refreshing={false} onRefresh={reload} />}>
      <LargeHeader title="Repairs" />
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading && !data ? <Skeleton /> : (
        <>
          <Section title="In progress" testID="tenant-tickets-open">
            {open.length ? open.map((t, i) => <TicketRow key={t.id} t={t} role="tenant" index={i} />) : <EmptyState testID="tenant-tickets-none" icon="leaf-outline" title="No repairs" action="Report a problem" onAction={() => router.push("/(tenant)/chat")} />}
          </Section>
          <TextButton testID="tenant-done-toggle" label={`Done (${done.length}) ${showDone ? "⌄" : "›"}`} onPress={() => setShowDone(!showDone)} />
          {showDone ? done.map((t, i) => <TicketRow key={t.id} t={t} role="tenant" index={i} />) : null}
        </>
      )}
    </Screen>
  );
}
