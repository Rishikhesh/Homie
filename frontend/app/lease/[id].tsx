import React, { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, money } from "@/src/api";
import { useLive } from "@/src/useLive";
import { useAuth } from "@/src/auth";
import { openPdf } from "@/src/cards";
import { BigButton, Card, Field, LargeHeader, Screen, Skeleton, TextButton, Txt, useToast } from "@/src/ui";
import { spacing, useTheme } from "@/src/theme";
import { IconRow, More, SIGN_STEPS, Status, Tracker, burst } from "@/src/visual";

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
      <LargeHeader title="Lease" back={() => router.back()} />
      <Card style={{ marginBottom: spacing.xl, gap: spacing.md }} testID="lease-key-terms">
        <Tracker steps={SIGN_STEPS} current={l.status === "signed" ? 3 : 1} mine={canSign} />
        <Status kind={l.status === "signed" ? "good" : canSign ? "you" : "waiting"} label={l.status === "signed" ? "Signed" : canSign ? "Your turn to sign" : isTenant ? "Waiting for owner" : "Waiting for tenant"} />
        <IconRow icon="cash" label="Rent" value={money(t.rent)} />
        <IconRow icon="calendar" label="Due day" value={String(t.due_day)} />
        <IconRow icon="lock-closed" label={t.deposit_paid ? "Deposit (paid)" : "Deposit"} value={money(t.deposit)} />
        <IconRow icon="paw" label={`Pets: ${t.pets || "ask first"}`} />
        <IconRow icon="flash" label={`Utilities: ${t.utilities || "see lease"}`} />
        <IconRow icon="calendar-number" label="Ends" value={t.end ? new Date(`${t.end}T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "—"} />
      </Card>
      <Card style={{ marginBottom: spacing.lg }}>
        <More label="Read full lease" testID="lease-full-toggle">
          {l.summary ? <Txt v="small">{l.summary}</Txt> : null}
          {(l.chunks || []).map((c: string, i: number) => <Txt key={i} v="body" style={{ marginBottom: spacing.md }}>{c}</Txt>)}
        </More>
      </Card>
      {l.signatures.map((s: any, i: number) => <Status key={i} size="sm" kind="good" label={`${s.role === "tenant" ? "Tenant" : "Owner"}: ${s.typed_name}`} />)}
      {canSign ? (
        <View style={{ gap: spacing.md, marginTop: spacing.xl }}>
          <Field testID="lease-sign-name" label="Type your full name to sign" value={name} onChangeText={setName} autoCapitalize="words" />
          <BigButton testID="lease-sign-button" label="Sign" loading={busy} disabled={name.trim().length < 3} onPress={async () => { setBusy(true); try { await api(`/leases/${id}/sign`, { body: { typed_name: name } }); burst("Signed"); reload(); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); } }} />
          <Txt v="small">Simulated e-signature.</Txt>
        </View>
      ) : null}
      {l.status === "signed" ? <TextButton testID="lease-pdf-button" icon="document-text-outline" label={l.source === "upload" ? "Original PDF" : "Signed PDF"} onPress={() => openPdf(`/leases/${id}/pdf`)} /> : null}
      <Txt v="small" color={colors.muted} style={{ marginTop: spacing.lg }}>Fingerprint: {l.doc_hash.slice(0, 16)}…</Txt>
    </Screen>
  );
}
