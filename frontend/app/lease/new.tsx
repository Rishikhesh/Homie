import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, money } from "@/src/api";
import { DateTimeField } from "@/src/inputs";
import { BigButton, Card, Field, LargeHeader, Row, Screen, TextButton, Txt, useToast, Ionicons } from "@/src/ui";
import { spacing, useTheme } from "@/src/theme";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;

export default function NewLease() {
  const { unit } = useLocalSearchParams<{ unit: string }>();
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const [step, setStep] = useState(0);
  const [info, setInfo] = useState<any>(null);
  const [rules, setRules] = useState<any>(null);
  const [f, setF] = useState<any>({ late_fee: "50", notice_days: "30", pets: "No pets without written permission." });
  const [start, setStart] = useState<Date | null>(null);
  const [end, setEnd] = useState<Date | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    (async () => {
      const props = await api<any[]>("/properties");
      for (const p of props) {
        const d = await api(`/properties/${p.id}`);
        const u = d.units.find((x: any) => x.id === unit);
        if (u) { setInfo({ p: d, u }); setF((o: any) => ({ ...o, rent: String(u.rent), deposit: String(u.rent) })); setRules(await api(`/state-rules/${d.state}`).catch(() => null)); break; }
      }
    })();
  }, [unit]);
  if (!info) return <Screen><Txt v="body">Loading…</Txt></Screen>;
  const dep = Number(f.deposit || 0);
  const warn = rules?.deposit_months && dep > rules.deposit_months * Number(f.rent || 0);
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  return (
    <Screen testID="new-lease-screen">
      <LargeHeader title="Prepare lease" subtitle={`Step ${step + 1} of 3`} back={() => (step ? setStep(step - 1) : router.back())} />
      {step === 0 ? (
        <Card style={{ gap: spacing.sm }} testID="lease-step-home">
          <Txt v="h2">{info.p.name}</Txt>
          <Txt v="body">{info.u.label} · {info.p.address}, {info.p.city} {info.p.state}</Txt>
          <BigButton testID="lease-next-0" label="Next" onPress={() => setStep(1)} />
        </Card>
      ) : step === 1 ? (
        <Card style={{ gap: spacing.sm }} testID="lease-step-tenant">
          <Txt v="h2">Tenant</Txt>
          <Txt v="body">{info.u.tenant?.name || info.u.invite?.email}</Txt>
          {!info.u.tenant ? <Txt v="small">They&apos;ll see the lease right after accepting the invite.</Txt> : null}
          <BigButton testID="lease-next-1" label="Next" onPress={() => setStep(2)} />
        </Card>
      ) : (
        <View style={{ gap: spacing.lg }} testID="lease-step-terms">
          <Field testID="lease-rent-input" label="Rent ($/mo)" keyboardType="decimal-pad" value={f.rent} onChangeText={(v) => set("rent", v)} />
          <Field testID="lease-deposit-input" label="Security deposit ($)" keyboardType="decimal-pad" value={f.deposit} onChangeText={(v) => set("deposit", v)} />
          {warn ? <Row><Ionicons name="warning" size={18} color={colors.error} /><Txt v="label" color={colors.error} style={{ flex: 1 }}>{rules.name} limits deposits to {rules.deposit_limit}. {money(dep)} may be above the legal limit.</Txt></Row> : null}
          <DateTimeField mode="date" testID="lease-start" label="Start" value={start} onChange={setStart} />
          <DateTimeField mode="date" testID="lease-end" label="End" value={end} onChange={setEnd} />
          <TextButton testID="lease-more-toggle" label={more ? "Fewer details" : "More details"} onPress={() => setMore(!more)} />
          {more ? (
            <>
              <Field testID="lease-latefee-input" label="Late fee ($)" keyboardType="decimal-pad" value={f.late_fee} onChangeText={(v) => set("late_fee", v)} />
              <Field testID="lease-pets-input" label="Pets" value={f.pets} onChangeText={(v) => set("pets", v)} />
              <Field testID="lease-notice-input" label="Notice days" keyboardType="number-pad" value={f.notice_days} onChangeText={(v) => set("notice_days", v)} />
              <Field testID="lease-utilities-input" label="Utilities" value={f.utilities || ""} onChangeText={(v) => set("utilities", v)} placeholder="Tenant pays electric, gas and internet" />
            </>
          ) : null}
          <BigButton testID="lease-send-button" label="Send to tenant" loading={busy} disabled={!start || !end || !f.rent} onPress={async () => {
            setBusy(true);
            try {
              const l = await api("/leases", { body: { unit_id: unit, terms: { ...f, rent: Number(f.rent), deposit: dep, late_fee: Number(f.late_fee), notice_days: Number(f.notice_days), due_day: info.u.due_day, start: ymd(start!), end: ymd(end!) } } });
              toast("Lease sent"); router.replace(`/lease/${l.id}`);
            } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
          }} />
        </View>
      )}
    </Screen>
  );
}
