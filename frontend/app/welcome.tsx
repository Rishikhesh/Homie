import React, { useState } from "react";
import { View } from "react-native";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { BigButton, Card, Chip, Field, Ionicons, Screen, TextButton, Txt, useToast, LargeHeader, Row } from "@/src/ui";
import { spacing, useTheme, radius } from "@/src/theme";
import { Pressable } from "react-native";

import { TRADES, tradeLabel } from "@/src/constants";
import { CONTACT_CHOICES, ChoiceCards } from "@/src/call/ChoiceCards";

function RoleCard({ icon, title, body, onPress, testID, selected }: any) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => ({ padding: spacing.lg, borderRadius: radius.lg, borderWidth: selected ? 2 : 0.5, borderColor: selected ? colors.brandPrimary : colors.border, backgroundColor: colors.surfaceSecondary, flexDirection: "row", gap: spacing.lg, alignItems: "center", opacity: pressed ? 0.85 : 1 })}>
      <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" }}><Ionicons name={icon} size={20} color={colors.onBrandSecondary} /></View>
      <View style={{ flex: 1 }}><Txt v="h2">{title}</Txt><Txt v="body" color={colors.muted}>{body}</Txt></View>
    </Pressable>
  );
}

function Invites({ list, onAccepted }: { list: any[]; onAccepted: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <View style={{ gap: spacing.md }}>
      {list.map((i) => (
        <Card key={i.id} agent testID={`invite-card-${i.id}`}>
          <Txt v="label">{i.text}</Txt>
          <Txt v="small" style={{ marginBottom: spacing.md }}>{i.sub}</Txt>
          <BigButton testID={`invite-accept-${i.id}`} label="Accept" loading={busy === i.id} onPress={async () => { setBusy(i.id); try { await api(`/invites/${i.id}/accept`, { method: "POST" }); toast("You're in!"); onAccepted(); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(null); } }} />
        </Card>
      ))}
    </View>
  );
}

export default function Welcome() {
  const { me, refresh, signOut } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [trades, setTrades] = useState<string[]>([]);
  const [zip, setZip] = useState("");
  const [place, setPlace] = useState<any>(null);
  const [phone, setPhone] = useState("");
  const [pref, setPref] = useState("message");
  const role = me?.user?.role;

  const setRole = async (r: string, start?: string) => {
    setBusy(true);
    try { await api("/auth/role", { body: { role: r, start } }); await refresh(); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  const lookupZip = async (z: string) => {
    setZip(z);
    if (z.length === 5) { try { setPlace(await api(`/zip/${z}`)); } catch (e: any) { toast(e.message, "error"); } }
  };

  if (!role) {
    return (
      <Screen testID="welcome-role-screen">
        <LargeHeader title={`Hi ${me?.user?.name?.split(" ")[0] || ""}`} subtitle="I am a:" />
        <View style={{ gap: spacing.md }}>
          <RoleCard testID="role-landlord" icon="home" title="Landlord" body="I rent out a home or rooms" selected={pick === "landlord"} onPress={() => setPick("landlord")} />
          <RoleCard testID="role-tenant" icon="key" title="Tenant" body="I rent from a landlord on Rentwise" selected={pick === "tenant"} onPress={() => setRole("tenant")} />
          <RoleCard testID="role-handyman" icon="construct" title="Handyman" body="I fix things for landlords" selected={pick === "handyman"} onPress={() => setRole("handyman")} />
        </View>
        {pick === "landlord" ? (
          <Card agent style={{ marginTop: spacing.xl, gap: spacing.md }} testID="landlord-start-card">
            <Txt v="h2">How do you want to start?</Txt>
            <Txt v="body" color={colors.muted}>A sample home lets you try everything: tenants Tom and Maria, handyman Hank and 6 months of rent history. It&apos;s private to you and you can reset it any time.</Txt>
            <BigButton testID="start-sample-button" label="Start with a sample home" loading={busy} onPress={() => setRole("landlord", "sample")} />
            <TextButton testID="start-empty-button" label="Start empty" onPress={() => setRole("landlord", "empty")} />
          </Card>
        ) : null}
        <TextButton testID="welcome-switch-account" label="Use a different Google account" onPress={signOut} color={colors.muted} />
      </Screen>
    );
  }

  if (role === "tenant") {
    const inv = (me?.invites || []).filter((i: any) => i.kind === "tenant");
    return (
      <Screen testID="welcome-tenant-screen">
        <LargeHeader title="Your home" subtitle={me?.user?.email} />
        {inv.length ? <Invites list={inv} onAccepted={refresh} /> : (
          <Card testID="no-invite-card" style={{ gap: spacing.md }}>
            <Ionicons name="mail-unread-outline" size={28} color={colors.brandPrimary} />
            <Txt v="h2">No invite yet</Txt>
            <Txt v="body">Ask your landlord to add <Txt v="label">{me?.user?.email}</Txt> in Rentwise. It will show up here.</Txt>
            <BigButton testID="no-invite-refresh" label="Refresh" icon="refresh" onPress={async () => { await refresh(); toast("Checked for invites"); }} />
          </Card>
        )}
        <TextButton testID="tenant-switch-account" label="Use a different Google account" onPress={signOut} color={colors.muted} />
        <TextButton testID="tenant-change-role" label="I&apos;m not a tenant — change role" onPress={() => api("/auth/role", { body: { role: "landlord", start: "sample" } }).then(refresh).catch((e) => toast(e.message, "error"))} color={colors.muted} />
      </Screen>
    );
  }

  // handyman setup
  const inv = (me?.invites || []).filter((i: any) => i.kind === "handyman");
  return (
    <Screen testID="welcome-handyman-screen">
      <LargeHeader title="Set up your profile" subtitle="Landlords near you will send you jobs" />
      {inv.length ? <View style={{ marginBottom: spacing.xl }}><Invites list={inv} onAccepted={refresh} /></View> : null}
      <Txt v="label" style={{ marginBottom: spacing.sm }}>Your trades</Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.xl }}>
        {TRADES.map((t) => <Chip key={t} testID={`trade-chip-${t}`} label={tradeLabel(t)} selected={trades.includes(t)} onPress={() => setTrades(trades.includes(t) ? trades.filter((x) => x !== t) : [...trades, t])} />)}
      </View>
      <View style={{ gap: spacing.lg }}>
        <Field testID="handyman-zip-input" label="ZIP code" keyboardType="number-pad" maxLength={5} value={zip} onChangeText={lookupZip} hint={place ? `${place.city}, ${place.state}` : "City and state fill in automatically"} />
        <Field testID="handyman-phone-input" label="Phone" keyboardType="phone-pad" value={phone} onChangeText={setPhone} hint="Never shared with tenants" />
        <Txt v="label">How should Rentwise reach you about new jobs?</Txt>
        <ChoiceCards testIDPrefix="setup-contact-pref" choices={CONTACT_CHOICES} value={pref} onChange={setPref} />
        <BigButton testID="handyman-setup-done" label="Done" loading={busy} disabled={!trades.length || !place} onPress={async () => {
          setBusy(true);
          try { await api("/handyman/setup", { body: { trades, zip, city: place.city, state: place.state, phone } }); await api("/handyman/profile", { method: "PATCH", body: { contact_pref: pref } }); await refresh(); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
        }} />
      </View>
      <Row style={{ justifyContent: "center" }}><TextButton testID="handyman-switch-account" label="Use a different Google account" onPress={signOut} color={colors.muted} /></Row>
    </Screen>
  );
}
