import React, { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, money } from "@/src/api";
import { useLive } from "@/src/useLive";
import { openPdf } from "@/src/cards";
import { AgentMark, BigButton, Card, Chip, ChipRow, Divider, LargeHeader, Row, Screen, Section, Skeleton, TextButton, Txt, useToast } from "@/src/ui";
import { spacing } from "@/src/theme";

export default function Report() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const { data: r } = useLive<any>(() => api(`/reports/${id}?year=${year}`), 0, [id, year]);
  const [notes, setNotes] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!r) return <Screen><Skeleton /></Screen>;
  return (
    <Screen testID="report-screen">
      <LargeHeader title="Year-end report" subtitle={`${r.property.name} · Schedule E`} back={() => router.back()} />
      <ChipRow>{[0, 1].map((k) => { const y = new Date().getFullYear() - k; return <Chip key={y} testID={`report-year-${y}`} label={String(y)} selected={year === y} onPress={() => setYear(y)} />; })}</ChipRow>
      <Card style={{ marginBottom: spacing.xl }} testID="report-summary">
        <Txt v="caption">Line 3 · Rents received</Txt>
        <Txt v="money" testID="report-rents">{money(r.rents_received)}</Txt>
        {r.by_unit.map((u: any) => <Txt key={u.label} v="small">{u.label}: {money(u.rent)}</Txt>)}
        <Divider />
        {r.expense_lines.map((l: any) => <Row key={l.category} style={{ justifyContent: "space-between" }}><Txt v="body">Line {l.line} · {l.category}</Txt><Txt v="label" testID={`report-line-${l.category}`}>{money(l.amount)}</Txt></Row>)}
        {!r.expense_lines.length ? <Txt v="small">No expenses this year.</Txt> : null}
        <Divider />
        <Row style={{ justifyContent: "space-between" }}><Txt v="label">Total expenses</Txt><Txt v="label">{money(r.total_expenses)}</Txt></Row>
        <Row style={{ justifyContent: "space-between" }}><Txt v="label">Net</Txt><Txt v="label" testID="report-net">{money(r.net)}</Txt></Row>
        <Txt v="small" style={{ marginTop: spacing.sm }}>Security deposits held ({money(r.deposits_excluded)}) are not income and are excluded.</Txt>
      </Card>
      <Section title="Repairs & expenses">
        <Card>{r.expenses.length ? r.expenses.map((e: any, i: number) => <View key={e.id}>{i ? <Divider /> : null}<Row style={{ justifyContent: "space-between" }}><Txt v="body" style={{ flex: 1 }}>{e.date.slice(0, 10)} · {e.description}</Txt><Txt v="label">{money(e.amount)}</Txt></Row></View>) : <Txt v="small">Nothing yet.</Txt>}</Card>
      </Section>
      <BigButton testID="report-check-button" icon="sparkles" label="Check this report" loading={busy} onPress={async () => { setBusy(true); try { setNotes((await api(`/reports/${id}/check?year=${year}`, { method: "POST" })).notes); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); } }} />
      {notes ? <Card agent style={{ marginTop: spacing.md }} testID="report-check-notes"><AgentMark /><Txt v="body">{notes}</Txt></Card> : null}
      <Row style={{ marginTop: spacing.lg, justifyContent: "center" }}>
        <TextButton testID="report-export-pdf" icon="document-outline" label="Export PDF" onPress={() => openPdf(`/reports/${id}/export?fmt=pdf&year=${year}`)} />
        <TextButton testID="report-export-csv" icon="grid-outline" label="Export CSV" onPress={() => openPdf(`/reports/${id}/export?fmt=csv&year=${year}`)} />
      </Row>
      <Txt v="small" style={{ textAlign: "center" }}>Not tax advice.</Txt>
    </Screen>
  );
}
