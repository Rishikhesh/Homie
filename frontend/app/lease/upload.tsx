import React, { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { api, money } from "@/src/api";
import { uploadAsset } from "@/src/inputs";
import { BigButton, Card, Field, Ionicons, LargeHeader, Row, Screen, Txt, useToast } from "@/src/ui";
import { spacing, useTheme } from "@/src/theme";

const KEYS: { k: string; label: string; num?: boolean; hint?: string }[] = [
  { k: "rent", label: "Rent ($/mo)", num: true },
  { k: "deposit", label: "Security deposit ($)", num: true },
  { k: "start", label: "Start date", hint: "YYYY-MM-DD" },
  { k: "end", label: "End date", hint: "YYYY-MM-DD" },
  { k: "due_day", label: "Rent due day", num: true },
  { k: "late_fee", label: "Late fee ($)", num: true },
  { k: "notice_days", label: "Notice days", num: true },
  { k: "pets", label: "Pets" },
  { k: "utilities", label: "Utilities" },
];

export default function UploadLease() {
  const { unit } = useLocalSearchParams<{ unit: string }>();
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const [phase, setPhase] = useState<"pick" | "reading" | "review">("pick");
  const [res, setRes] = useState<any>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [depPaid, setDepPaid] = useState(true);

  const pick = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    setPhase("reading");
    try {
      const fileId = await uploadAsset({ uri: a.uri, name: a.name || "lease.pdf", mimeType: a.mimeType || "application/pdf" });
      const out = await api("/leases/extract", { body: { unit_id: unit, file_id: fileId } });
      const t = out.terms || {};
      setF(Object.fromEntries(KEYS.map(({ k }) => [k, t[k] == null ? "" : String(t[k])])));
      setRes(out);
      setPhase("review");
    } catch (e: any) {
      toast(e.message, "error");
      setPhase("pick");
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const l = await api("/leases/upload", { body: { unit_id: unit, file_id: res.file_id, terms: { ...f, summary: res.terms?.summary, deposit_paid: depPaid } } });
      toast("Lease saved");
      router.replace(`/lease/${l.id}`);
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  const missing: string[] = (res?.terms?.missing || []).filter((k: string) => KEYS.some((x) => x.k === k));
  return (
    <Screen testID="upload-lease-screen">
      <LargeHeader title="Upload signed lease" subtitle={phase === "review" ? "Check what I found" : "Already signed on paper? Add it here"} back={() => (phase === "review" ? setPhase("pick") : router.back())} />
      {phase === "pick" ? (
        <Card agent style={{ gap: spacing.md }} testID="upload-lease-intro">
          <Ionicons name="document-attach-outline" size={32} color={colors.brand} />
          <Txt v="body">Pick the signed lease PDF. I&apos;ll read the rent, dates, deposit and rules, and use the lease to answer your tenant&apos;s questions.</Txt>
          <BigButton testID="pick-lease-pdf-button" icon="cloud-upload-outline" label="Choose PDF" onPress={pick} />
        </Card>
      ) : phase === "reading" ? (
        <Card style={{ alignItems: "center", gap: spacing.md, paddingVertical: spacing.xl }} testID="upload-lease-reading">
          <ActivityIndicator color={colors.brand} />
          <Txt v="label">Reading your lease…</Txt>
          <Txt v="small">This takes a few seconds.</Txt>
        </Card>
      ) : (
        <View style={{ gap: spacing.lg }} testID="upload-lease-review">
          <Card agent testID="upload-lease-summary">
            <Txt v="label">What I found</Txt>
            {res.terms?.summary ? <Txt v="body">{res.terms.summary}</Txt> : null}
            {res.terms?.tenant_name ? <Txt v="small">Tenant on the lease: {res.terms.tenant_name}</Txt> : null}
            {f.rent ? <Txt v="money">{money(Number(f.rent))}<Txt v="body">/mo</Txt></Txt> : null}
          </Card>
          {missing.length ? (
            <Row><Ionicons name="alert-circle" size={18} color={colors.onWarningSoft} /><Txt v="label" color={colors.onWarningSoft} style={{ flex: 1 }}>I couldn&apos;t find: {missing.map((k) => KEYS.find((x) => x.k === k)!.label).join(", ")}. Fill these in if they apply.</Txt></Row>
          ) : null}
          {KEYS.map(({ k, label, num, hint }) => (
            <Field key={k} testID={`upload-lease-${k}-input`} label={label} placeholder={hint} keyboardType={num ? "decimal-pad" : "default"} value={f[k]} onChangeText={(v) => setF({ ...f, [k]: v })} />
          ))}
          <Card testID="deposit-paid-toggle" onPress={() => setDepPaid(!depPaid)}>
            <Row>
              <Ionicons name={depPaid ? "checkbox" : "square-outline"} size={22} color={colors.brand} />
              <Txt v="body" style={{ flex: 1 }}>The tenant already paid the deposit</Txt>
            </Row>
          </Card>
          <BigButton testID="save-uploaded-lease-button" label="Save lease" loading={busy} disabled={busy || !f.rent || !f.deposit || !f.start || !f.end} onPress={save} />
          <Txt v="small">Saved as signed. Your tenant can read it, and Doorman answers lease questions from it.</Txt>
        </View>
      )}
    </Screen>
  );
}
