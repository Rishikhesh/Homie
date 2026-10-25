import React, { useState } from "react";
import { RefreshControl, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, money, propertyPhoto } from "@/src/api";
import { useLive } from "@/src/useLive";
import { BigButton, Card, Divider, ErrorState, Field, LargeHeader, PhotoCard, Row, Screen, Section, Sheet, Skeleton, StatusPill, TextButton, Txt, useToast } from "@/src/ui";
import { spacing, useTheme } from "@/src/theme";

export default function PropertyDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const { data: p, error, reload } = useLive<any>(() => api(`/properties/${id}`), 4000, [id]);
  const [inv, setInv] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [rules, setRules] = useState<string | null>(null);
  const [room, setRoom] = useState<any>(null);
  if (error && !p) return <Screen><ErrorState message={error} onRetry={reload} /></Screen>;
  if (!p) return <Screen><Skeleton /></Screen>;
  const sr = p.state_rules;
  return (
    <Screen testID="property-detail-screen" refresh={<RefreshControl refreshing={false} onRefresh={reload} />}>
      <LargeHeader title={p.name} subtitle={`${p.address}, ${p.city} ${p.state}`} back={() => router.back()} />
      <View style={{ marginBottom: spacing.xl }}><PhotoCard uri={propertyPhoto(p.photo, p.id)} title={p.rental_type === "rooms" ? "Rented by room" : "Whole home"} subtitle={`${p.units.filter((u: any) => u.tenant).length}/${p.units.length} rented`} /></View>
      <Section title={p.rental_type === "rooms" ? "Rooms" : "Home"} testID="units-section" right={p.rental_type === "rooms" ? <TextButton testID="add-unit-button" label="Add room" icon="add" onPress={() => setRoom({ label: `Room ${String.fromCharCode(65 + p.units.length)}`, rent: "", due_day: "1" })} /> : undefined}>
        {p.units.map((u: any, i: number) => (
          <Card key={u.id} index={i} testID={`unit-card-${u.id}`}>
            <Row style={{ justifyContent: "space-between" }}>
              <Txt v="label" style={{ fontSize: 17 }}>{u.label}</Txt>
              <Txt v="label">{money(u.rent)}/mo · day {u.due_day}</Txt>
            </Row>
            {u.tenant ? (
              <>
                <Txt v="body">{u.tenant.name}{u.tenant.is_sample ? " (sample)" : ""}</Txt>
                <Row style={{ marginTop: 4 }}><StatusPill label={`Onboarding ${u.onboarding_steps}/3`} tone={u.onboarding_steps === 3 ? "success" : "warning"} />{u.lease ? <StatusPill label={u.lease.status === "signed" ? "Lease signed" : u.lease.status === "tenant_signed" ? "Sign your part" : "Lease sent"} tone={u.lease.status === "signed" ? "success" : "brand"} /> : null}</Row>
              </>
            ) : u.invite ? (
              <Row style={{ justifyContent: "space-between" }}><Txt v="small">Invite pending · {u.invite.email}</Txt><TextButton testID={`cancel-invite-${u.id}`} label="Cancel" color={colors.error} onPress={() => api(`/invites/${u.invite.id}`, { method: "DELETE" }).then(reload)} /></Row>
            ) : <Txt v="small">Vacant</Txt>}
            <Divider />
            <Row style={{ flexWrap: "wrap" }}>
              {!u.tenant && !u.invite ? <TextButton testID={`invite-tenant-${u.id}`} icon="person-add-outline" label="Invite tenant" onPress={() => setInv(u)} /> : null}
              {u.tenant?.is_sample ? <TextButton testID={`replace-tenant-${u.id}`} icon="swap-horizontal" label="Invite a real tenant" onPress={() => setInv({ ...u, replace: true })} /> : null}
              {(u.tenant || u.invite) && (!u.lease || u.lease.status !== "signed") ? <TextButton testID={`prepare-lease-${u.id}`} icon="document-text-outline" label={u.lease ? "Open lease" : "Prepare lease"} onPress={() => router.push(u.lease ? `/lease/${u.lease.id}` : `/lease/new?unit=${u.id}`)} /> : null}
              {u.lease?.status === "signed" ? <TextButton testID={`view-lease-${u.id}`} icon="document-text-outline" label="Lease" onPress={() => router.push(`/lease/${u.lease.id}`)} /> : null}
            </Row>
          </Card>
        ))}
      </Section>
      <Section title="House rules" testID="rules-section" right={<TextButton testID="edit-rules-button" label="Edit" onPress={() => setRules(p.house_rules || "")} />}>
        <Card><Txt v="body">{p.house_rules || "No rules yet. Rentwise follows whatever you write here."}</Txt></Card>
      </Section>
      <Section title="Utilities" testID="utilities-section">
        <Card>{["electric", "gas", "internet"].map((k) => <Txt key={k} v="body">{k[0].toUpperCase() + k.slice(1)}: {p.utilities?.[k] || "—"}</Txt>)}</Card>
      </Section>
      {sr ? (
        <Section title={`${sr.name} rules`} testID="state-rules-card">
          <Card>
            <Txt v="body">Deposit limit: {sr.deposit_limit}</Txt>
            <Txt v="body">Deposit return: {sr.deposit_return_days} days</Txt>
            <Txt v="body">Entry notice: {sr.entry_notice}</Txt>
            <Txt v="body">Late fees: {sr.late_fee_rule}</Txt>
            <Txt v="body">Rent increase notice: {sr.rent_increase_notice}</Txt>
            <Txt v="small" style={{ marginTop: spacing.sm }}>General info, not legal advice.</Txt>
          </Card>
        </Section>
      ) : null}

      <Sheet visible={!!inv} onClose={() => setInv(null)} title={`Invite a tenant to ${inv?.label}`} testID="invite-tenant-sheet">
        <Field testID="invite-tenant-email" label="Tenant's Google email" placeholder="name@gmail.com" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} hint="They'll see the invite when they sign in to Rentwise as a tenant. No email is sent." />
        <BigButton testID="invite-tenant-send" style={{ marginTop: spacing.lg }} label="Create invite" onPress={async () => { try { await api(`/units/${inv.id}/invite`, { body: { email, replace: !!inv.replace } }); toast("Invite created"); setInv(null); setEmail(""); reload(); } catch (e: any) { toast(e.message, "error"); } }} />
      </Sheet>
      <Sheet visible={rules !== null} onClose={() => setRules(null)} title="House rules" testID="rules-sheet">
        <Field testID="rules-input" label="Rules" multiline value={rules || ""} onChangeText={setRules} />
        <BigButton testID="rules-save" style={{ marginTop: spacing.lg }} label="Save" onPress={async () => { await api(`/properties/${id}`, { method: "PATCH", body: { house_rules: rules } }); setRules(null); reload(); }} />
      </Sheet>
      <Sheet visible={!!room} onClose={() => setRoom(null)} title="Add a room" testID="add-room-sheet">
        {room ? <View style={{ gap: spacing.md }}>
          <Field testID="room-label-input" label="Room name" value={room.label} onChangeText={(v) => setRoom({ ...room, label: v })} />
          <Field testID="room-rent-input" label="Rent ($/mo)" keyboardType="decimal-pad" value={room.rent} onChangeText={(v) => setRoom({ ...room, rent: v })} />
          <BigButton testID="room-save" label="Add room" disabled={!room.rent} onPress={async () => { await api(`/properties/${id}/units`, { body: { ...room, rent: Number(room.rent) } }); setRoom(null); reload(); }} />
        </View> : null}
      </Sheet>
    </Screen>
  );
}
