import React, { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, money } from "@/src/api";
import { useLive } from "@/src/useLive";
import { useAuth } from "@/src/auth";
import { openPdf } from "@/src/cards";
import { BigButton, Card, Field, LargeHeader, Screen, Section, Skeleton, StatusPill, TextButton, Txt, useToast } from "@/src/ui";
import { spacing, useTheme } from "@/src/theme";

export default function LeaseView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const { me } = useAuth();
  const { data: l, reload } = useLive<any>(() => api(`/leases/${id}`), 4000, [id]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  if (!l) return <Screen><Skeleton /></Screen>;
  const isTenant = me?.user?.id === l.tenant_id;
  const canSign = (isTenant && l.status === "sent") || (!isTenant && l.status === "tenant_signed");
  const t = l.terms;
  return (
    <Screen testID="lease-screen">
      <LargeHeader title="Lease" subtitle={l.status === "signed" ? "Fully signed" : l.status === "tenant_signed" ? "Tenant signed — waiting for owner" : "Waiting for tenant"} back={() => router.back()} />
      <Card agent style={{ marginBottom: spacing.xl }} testID="lease-key-terms">
        <Txt v="label">Key terms</Txt>
        <Txt v="money">{money(t.rent)}<Txt v="body">/mo</Txt></Txt>
        <Txt v="body">Due day {t.due_day} · Deposit {money(t.deposit)} · Late fee {money(t.late_fee || 0)}</Txt>
        <Txt v="body">{t.start} → {t.end} · {t.notice_days || 30} days notice</Txt>
        <Txt v="body">Pets: {t.pets || "Ask first"}</Txt>
      </Card>
      <Section title="Full text">
        <Card>{(l.chunks || []).map((c: string, i: number) => <Txt key={i} v="body" style={{ marginBottom: spacing.md }}>{c}</Txt>)}</Card>
      </Section>
      {l.signatures.map((s: any, i: number) => <StatusPill key={i} label={`${s.role === "tenant" ? "Tenant" : "Owner"}: ${s.typed_name} · ${s.signed_at.slice(0, 10)}`} tone="success" />)}
      {canSign ? (
        <View style={{ gap: spacing.md, marginTop: spacing.xl }}>
          <Field testID="lease-sign-name" label="Type your full name to sign" value={name} onChangeText={setName} autoCapitalize="words" />
          <BigButton testID="lease-sign-button" label="Sign" loading={busy} disabled={name.trim().length < 3} onPress={async () => { setBusy(true); try { await api(`/leases/${id}/sign`, { body: { typed_name: name } }); toast("Signed"); reload(); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); } }} />
          <Txt v="small">Simulated e-signature. Your typed name, the time and a document fingerprint are recorded.</Txt>
        </View>
      ) : null}
      {l.status === "signed" ? <TextButton testID="lease-pdf-button" icon="document-text-outline" label="Signed PDF" onPress={() => openPdf(`/leases/${id}/pdf`)} /> : null}
      <Txt v="small" color={colors.muted} style={{ marginTop: spacing.lg }}>Fingerprint: {l.doc_hash.slice(0, 16)}…</Txt>
    </Screen>
  );
}
