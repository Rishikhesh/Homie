import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { useLive } from "@/src/useLive";
import { useAuth } from "@/src/auth";
import { BigButton, Card, ConfirmSheet, Divider, Field, LargeHeader, Row, Screen, Section, Skeleton, StatusPill, TextButton, Txt, useToast } from "@/src/ui";
import { useTheme } from "@/src/theme";
import { AutoHistory } from "@/src/AutoHistory";
import { SharedDemoSwitch } from "@/src/SharedDemoSwitch";

export default function Settings() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const { me, signOut, actAs, refresh } = useAuth();
  const isLandlord = me?.user?.role === "landlord";
  const { data: s, reload } = useLive<any>(() => api("/settings"), 0);
  const facts = useLive<any[]>(() => api("/facts"), 0);
  const people = useLive<any[]>(() => (isLandlord ? api("/sample/people") : Promise.resolve([])), 0);
  const [name, setName] = useState("");
  const [pay, setPay] = useState("");
  const [pol, setPol] = useState("");
  const [lim, setLim] = useState("");
  const [reset, setReset] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (s) { setName(s.name); setPay(s.payment_details || ""); setLim(s.auto_approve_limit != null ? String(s.auto_approve_limit).replace(/\.0+$/, "") : ""); } }, [s]);
  if (!s) return <Screen><Skeleton /></Screen>;
  const save = async (body: any, msg = "Saved") => { try { await api("/settings", { method: "PUT", body }); toast(msg); reload(); refresh(); } catch (e: any) { toast(e.message, "error"); } };
  return (
    <Screen testID="settings-screen">
      <LargeHeader title="Settings" subtitle={s.email} back={() => router.back()} />
      <Section title="Profile">
        <Field testID="settings-name-input" label="Your name" value={name} onChangeText={setName} />
        {isLandlord ? <Field testID="settings-payment-input" label="Payment details shown to tenants" value={pay} onChangeText={setPay} placeholder="Zelle: you@email.com" /> : null}
        <BigButton testID="settings-save-profile" tone="soft" label="Save profile" onPress={() => save({ name, payment_details: pay })} />
      </Section>
      {isLandlord ? (
        <Section title="Auto-OK repairs" testID="auto-limit-section">
          <Field testID="auto-limit-input" label="Auto-OK repairs up to ($)" value={lim} onChangeText={(v) => setLim(v.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"))} keyboardType="decimal-pad" placeholder="200"
            hint={Number(lim) > 0 ? `When a handyman's price is $${lim} or less and the tenant agrees, it's booked without your tap. You still tap to pay.` : "Off. Every price needs your tap."} />
          <BigButton testID="auto-limit-save" tone="soft" label="Save limit" onPress={() => save({ auto_approve_limit: Number(lim) || 0 }, Number(lim) > 0 ? `Auto-OK up to $${lim}` : "Auto-OK turned off")} />
          <AutoHistory />
        </Section>
      ) : null}
      {isLandlord ? (
        <Section title="What Homi follows" testID="policies-section">
          <Card agent>
            {(s.policies || []).map((p: string, i: number) => (
              <Row key={i} style={{ justifyContent: "space-between" }}>
                <Txt v="body" style={{ flex: 1 }}>• {p}</Txt>
                <TextButton testID={`policy-remove-${i}`} label="Remove" color={colors.error} onPress={() => save({ policies: s.policies.filter((_: any, j: number) => j !== i) }, "Removed")} />
              </Row>
            ))}
            {!s.policies?.length ? <Txt v="small">e.g. “Hank for plumbing”, “No visits before 9 am”. Money always needs your tap, except repairs under your auto-OK limit.</Txt> : null}
          </Card>
          <Field testID="policy-input" label="Add an instruction" value={pol} onChangeText={setPol} placeholder="Use the marketplace only if my handymen are busy" />
          <BigButton testID="policy-add" tone="soft" label="Add" disabled={!pol.trim()} onPress={() => { save({ policies: [...(s.policies || []), pol.trim()] }, "Homi will follow this"); setPol(""); }} />
        </Section>
      ) : null}
      <Section title="What Homi remembers" testID="facts-section">
        <Card>
          {(facts.data || []).map((f: any, i: number) => (
            <View key={f.id}>{i ? <Divider /> : null}
              <Row style={{ justifyContent: "space-between" }}>
                <View style={{ flex: 1 }}><Txt v="body">{f.text}</Txt><Txt v="small">About {f.about}</Txt></View>
                <TextButton testID={`fact-delete-${f.id}`} label="Delete" color={colors.error} onPress={async () => { await api(`/facts/${f.id}`, { method: "DELETE" }); facts.reload(); }} />
              </Row>
            </View>
          ))}
          {!facts.data?.length ? <Txt v="small">Nothing saved yet. Homi remembers helpful facts like pets or gate codes.</Txt> : null}
        </Card>
      </Section>
      {me?.is_admin ? <SharedDemoSwitch onChange={() => people.reload()} /> : null}
      {isLandlord && people.data?.length ? (
        <Section title="Try it yourself" testID="sample-section" right={<StatusPill label="Sample home" tone="brand" />}>
          <Txt v="body" color={colors.muted}>See exactly what your tenant or handyman sees, on this phone.</Txt>
          {people.data.map((p: any) => { const f = p.name.split(" ")[0]; return <BigButton key={p.id} tone="soft" testID={`try-as-${p.shared ? "shared-" : ""}${f.toLowerCase()}`} icon="swap-horizontal" label={`Try as ${f} (${p.role}${p.shared ? " · shared demo" : ""})`} onPress={async () => { await actAs(p.id); router.replace(`/(${p.role})` as any); }} />; })}
          <TextButton testID="sample-reset-button" label="Reset sample data" color={colors.error} onPress={() => setReset(true)} />
        </Section>
      ) : null}
      {isLandlord && people.data && !people.data.length ? (
        <Section title="Sample home"><BigButton testID="sample-create-button" tone="soft" label="Add a sample home" onPress={() => setReset(true)} /></Section>
      ) : null}
      {s.demo ? <TextButton testID="visual-qa-link" icon="color-palette-outline" label="Visual QA ›" onPress={() => router.push("/visual-qa")} /> : null}
      <BigButton testID="settings-sign-out" tone="danger" label="Switch account (sign out)" onPress={signOut} />
      <ConfirmSheet visible={reset} onClose={() => setReset(false)} title="Rebuild the sample home?" body="This resets Maple House, Tom, Maria and Hank to the starting point. Your real homes are not touched." confirmLabel="Reset sample data" danger loading={busy}
        onConfirm={async () => { setBusy(true); try { await api("/sample/reset", { method: "POST" }); toast("Sample home rebuilt"); setReset(false); people.reload(); facts.reload(); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); } }} testID="reset-confirm" />
    </Screen>
  );
}
