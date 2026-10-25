import React, { useState } from "react";
import { RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { api, money, ago } from "@/src/api";
import { useLive } from "@/src/useLive";
import { BigButton, Card, Chip, ChipRow, ConfirmSheet, Divider, EmptyState, ErrorState, Field, LargeHeader, Row, Screen, Section, Sheet, Skeleton, StatusPill, TextButton, Txt, useToast } from "@/src/ui";
import { spacing, useTheme } from "@/src/theme";

const CATS = ["Insurance", "Taxes", "Mortgage interest", "Utilities", "Cleaning and maintenance", "Supplies", "Other"];
const TONE: any = { paid: "success", due: "warning", overdue: "error", upcoming: "neutral" };

export default function Money() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const ov = useLive<any>(() => api("/money/overview"), 3000);
  const bank = useLive<any>(() => api("/money/bank"), 3000);
  const [sheet, setSheet] = useState<null | "connect" | "sim" | "expense" | "cash" | { assign: any }>(null);
  const [f, setF] = useState<any>({});
  const [cash, setCash] = useState<any>(null);
  const reload = () => { ov.reload(); bank.reload(); };
  const run = async (fn: () => Promise<any>, msg: string) => { try { await fn(); toast(msg); setSheet(null); setF({}); reload(); } catch (e: any) { toast(e.message, "error"); } };
  const d = ov.data;
  const rooms = (d?.properties || []).flatMap((p: any) => p.units.filter((u: any) => u.tenant_name).map((u: any) => ({ ...u, pname: p.property.name })));
  return (
    <Screen tab testID="money-screen" refresh={<RefreshControl refreshing={false} onRefresh={reload} />}>
      <LargeHeader title="Money" subtitle={d ? `${d.month} · ${money(d.collected)} collected` : undefined}
        actions={[{ label: "Record cash", icon: "cash-outline", onPress: () => setSheet("cash"), testID: "record-cash-button" }]} />
      {ov.error ? <ErrorState message={ov.error} onRetry={reload} /> : null}
      {!d ? <Skeleton /> : (
        <>
          <Section title="This month" testID="money-month-section">
            {d.properties.map((p: any, i: number) => (
              <Card key={p.property.id} index={i} testID={`money-property-${p.property.id}`}>
                <Row style={{ justifyContent: "space-between" }}>
                  <Txt v="label" style={{ fontSize: 17 }}>{p.property.name}</Txt>
                  <TextButton testID={`year-report-${p.property.id}`} label="Year-end report ›" onPress={() => router.push(`/report/${p.property.id}`)} />
                </Row>
                {p.units.map((u: any) => (
                  <View key={u.unit.id}>
                    <Divider />
                    <Row style={{ justifyContent: "space-between" }}>
                      <View style={{ flex: 1 }}>
                        <Txt v="body">{u.unit.label} · {u.tenant_name || "Vacant"}</Txt>
                        {u.month ? <Txt v="small">{money(u.month.paid)} of {money(u.month.due)}{u.overdue ? ` · ${money(u.overdue)} overdue` : ""}</Txt> : null}
                      </View>
                      {u.month ? <StatusPill testID={`rent-status-${u.unit.id}`} label={u.month.status === "paid" ? "Paid" : u.overdue ? "Overdue" : "Due"} tone={u.overdue ? "error" : TONE[u.month.status]} /> : null}
                    </Row>
                  </View>
                ))}
              </Card>
            ))}
            {!d.properties.length ? <EmptyState testID="money-empty" title="No rent yet" body="Add a property and invite tenants to start tracking rent." /> : null}
          </Section>

          <Section title="Bank feed" testID="bank-section" right={<StatusPill label="Simulated" tone="neutral" />}>
            {!bank.data?.connected ? (
              <EmptyState testID="bank-connect-empty" icon="card-outline" title="Connect your bank" body="Rentwise matches rent deposits to tenants automatically." action="Connect bank" onAction={() => setSheet("connect")} />
            ) : (
              <>
                <Txt v="small">Connected ({bank.data.bank_name})</Txt>
                {d.demo ? <BigButton testID="simulate-deposit-button" tone="soft" icon="flash-outline" label="Simulate incoming deposit" onPress={() => setSheet("sim")} /> : null}
              </>
            )}
            {bank.data?.review?.length ? (
              <Card testID="bank-review-card" style={{ borderColor: colors.warning }}>
                <Txt v="label">Needs review</Txt>
                {bank.data.review.map((t: any) => (
                  <View key={t.id}><Divider />
                    <Row style={{ justifyContent: "space-between" }}>
                      <View style={{ flex: 1 }}><Txt v="body">{t.sender_name} · {money(t.amount)}</Txt><Txt v="small">{t.memo} · {ago(t.date)}</Txt></View>
                      <TextButton testID={`bank-review-${t.id}`} label="Sort" onPress={() => setSheet({ assign: t })} />
                    </Row>
                  </View>
                ))}
              </Card>
            ) : null}
            {bank.data?.feed?.length ? (
              <Card>
                {bank.data.feed.slice(0, 12).map((t: any, i: number) => (
                  <View key={t.id}>{i ? <Divider /> : null}
                    <Row style={{ justifyContent: "space-between" }}>
                      <View style={{ flex: 1 }}><Txt v="body">{t.sender_name}</Txt><Txt v="small">{t.date.slice(0, 10)} · {t.status === "matched" ? "Matched to rent" : "Not rent"}</Txt></View>
                      <Txt v="label">{money(t.amount)}</Txt>
                    </Row>
                  </View>
                ))}
              </Card>
            ) : null}
          </Section>

          <Section title="Expenses" testID="expenses-section" right={<TextButton testID="add-expense-button" label="Add" icon="add" onPress={() => setSheet("expense")} />}>
            {d.expenses.length ? (
              <Card>
                {d.expenses.slice(0, 15).map((e: any, i: number) => (
                  <View key={e.id}>{i ? <Divider /> : null}
                    <Row style={{ justifyContent: "space-between" }}>
                      <View style={{ flex: 1 }}><Txt v="body">{e.description || e.category}</Txt><Txt v="small">{e.category} · {e.date.slice(0, 10)}</Txt></View>
                      <Txt v="label">{money(e.amount)}</Txt>
                    </Row>
                  </View>
                ))}
              </Card>
            ) : <EmptyState testID="expenses-empty" title="No expenses yet" body="Repairs paid through Rentwise land here automatically. Add insurance, taxes and more yourself." />}
          </Section>
        </>
      )}

      <Sheet visible={sheet === "connect"} onClose={() => setSheet(null)} title="Pick your bank" testID="bank-connect-sheet">
        <Txt v="small" style={{ marginBottom: spacing.md }}>Demo only — no real bank connection.</Txt>
        {["Demo Bank", "Chase (demo)", "Wells Fargo (demo)"].map((b, i) => <BigButton key={b} testID={`bank-option-${i}`} tone="soft" label={b} style={{ marginBottom: spacing.sm }} onPress={() => run(() => api("/money/bank/connect", { body: { bank: b } }), "Bank connected (simulated)")} />)}
      </Sheet>
      <Sheet visible={sheet === "sim"} onClose={() => setSheet(null)} title="Simulate a deposit" testID="simulate-sheet">
        <View style={{ gap: spacing.md }}>
          <Field testID="sim-sender-input" label="Sender name" value={f.sender || ""} onChangeText={(v) => setF({ ...f, sender: v })} hint="Exact tenant name auto-matches, e.g. Tom Chen" />
          <Field testID="sim-amount-input" label="Amount ($)" keyboardType="decimal-pad" value={f.amount || ""} onChangeText={(v) => setF({ ...f, amount: v })} />
          <BigButton testID="sim-submit" label="Add deposit" onPress={() => run(() => api("/money/bank/simulate", { body: { sender_name: f.sender, amount: Number(f.amount) } }), "Deposit added")} />
        </View>
      </Sheet>
      <Sheet visible={sheet === "expense"} onClose={() => setSheet(null)} title="Add an expense" testID="expense-sheet">
        <View style={{ gap: spacing.md }}>
          <Txt v="label">Property</Txt>
          <ChipRow>{(d?.properties || []).map((p: any) => <Chip key={p.property.id} testID={`expense-prop-${p.property.id}`} label={p.property.name} selected={f.pid === p.property.id} onPress={() => setF({ ...f, pid: p.property.id })} />)}</ChipRow>
          <Txt v="label">Category</Txt>
          <ChipRow>{CATS.map((c) => <Chip key={c} testID={`expense-cat-${c}`} label={c} selected={f.cat === c} onPress={() => setF({ ...f, cat: c })} />)}</ChipRow>
          <Field testID="expense-amount-input" label="Amount ($)" keyboardType="decimal-pad" value={f.amount || ""} onChangeText={(v) => setF({ ...f, amount: v })} />
          <Field testID="expense-desc-input" label="What was it?" value={f.desc || ""} onChangeText={(v) => setF({ ...f, desc: v })} />
          <BigButton testID="expense-save" label="Save expense" disabled={!f.pid || !f.amount} onPress={() => run(() => api("/money/expenses", { body: { property_id: f.pid, category: f.cat || "Other", amount: Number(f.amount), description: f.desc } }), "Expense saved")} />
        </View>
      </Sheet>
      <Sheet visible={sheet === "cash"} onClose={() => setSheet(null)} title="Record a cash payment" testID="cash-sheet">
        <View style={{ gap: spacing.md }}>
          {rooms.length ? rooms.map((u: any) => <Chip key={u.unit.id} testID={`cash-room-${u.unit.id}`} label={`${u.pname} · ${u.unit.label} · ${u.tenant_name}`} selected={f.uid === u.unit.id} onPress={() => setF({ ...f, uid: u.unit.id, amount: String(u.month?.due - u.month?.paid || u.unit.rent) })} />) : <Txt v="body">No rented rooms yet.</Txt>}
          <Field testID="cash-amount-input" selectTextOnFocus label="Amount ($)" keyboardType="decimal-pad" value={f.amount || ""} onChangeText={(v) => setF({ ...f, amount: v })} />
          <BigButton testID="cash-save" label="Record payment" disabled={!f.uid} onPress={() => setCash({ uid: f.uid, amount: Number(f.amount) })} />
        </View>
      </Sheet>
      <Sheet visible={!!(sheet && typeof sheet === "object")} onClose={() => setSheet(null)} title="Who sent this?" testID="assign-sheet">
        {sheet && typeof sheet === "object" ? (
          <View style={{ gap: spacing.sm }}>
            <Txt v="body">{sheet.assign.sender_name} · {money(sheet.assign.amount)}</Txt>
            {(bank.data?.tenants || []).map((t: any) => <BigButton key={t.tenant_id} tone="soft" testID={`assign-tenant-${t.tenant_id}`} label={`${t.name} · ${t.unit_label}`} onPress={() => run(() => api(`/money/bank/${sheet.assign.id}/assign`, { body: { tenant_id: t.tenant_id } }), "Recorded as rent")} />)}
            <TextButton testID="assign-not-rent" label="Not rent" onPress={() => run(() => api(`/money/bank/${sheet.assign.id}/assign`, { body: { not_rent: true } }), "Marked as not rent")} />
          </View>
        ) : null}
      </Sheet>
      <ConfirmSheet visible={!!cash} onClose={() => setCash(null)} title="Record cash payment?" amount={cash?.amount} confirmLabel="Record payment" testID="cash-confirm"
        onConfirm={() => { const c = cash; setCash(null); run(() => api("/money/cash", { body: { unit_id: c.uid, amount: c.amount } }), "Payment recorded"); }} />
    </Screen>
  );
}
