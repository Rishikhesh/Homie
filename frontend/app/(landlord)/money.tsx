import React, { useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { api, money, ago } from "@/src/api";
import { useLive } from "@/src/useLive";
import { BigButton, Card, Ionicons, Chip, ChipRow, ConfirmSheet, Divider, EmptyState, ErrorState, Field, LargeHeader, Row, Screen, Section, Sheet, Skeleton, StatusPill, TextButton, Txt, useToast } from "@/src/ui";
import { radius, spacing, useTheme } from "@/src/theme";
import { BankCard } from "@/src/bank";
import { BigNumber, IconRow, Status } from "@/src/visual";
import { KIND_ICON, kindColor, statusOf } from "@/src/status";

const CAT_ICON: any = { Repairs: "construct", Insurance: "shield-checkmark", Taxes: "business", "Mortgage interest": "home", Utilities: "flash", "Cleaning and maintenance": "sparkles", Supplies: "cart", Other: "ellipsis-horizontal" };

function RentGrid() {
  const { colors } = useTheme();
  const { data: g } = useLive<any>(() => api("/money/grid"), 15000);
  const [cell, setCell] = useState<any>(null);
  if (!g?.rows?.length) return null;
  return (
    <Card testID="rent-grid" style={{ gap: spacing.sm }}>
      <Row style={{ gap: 4 }}>
        <View style={{ width: 92 }} />
        {g.periods.map((p: any) => <Txt key={p.period} v="caption" style={{ flex: 1, textAlign: "center" }}>{p.label}</Txt>)}
      </Row>
      {g.rows.map((r: any) => (
        <Row key={r.unit_id} style={{ gap: 4 }}>
          <View style={{ width: 92 }}><Txt v="label" numberOfLines={1}>{r.label.replace("Whole home", "Home")}</Txt><Txt v="small" numberOfLines={1}>{r.tenant || "Empty"}</Txt></View>
          {r.cells.map((c: any) => {
            const st = statusOf({ ...c, due_day: r.due_day }, "landlord", "rent");
            return (
              <Pressable key={c.period} testID={`grid-${r.unit_id}-${c.period}`} accessibilityLabel={`${r.label} ${c.period}: ${st.label}`} onPress={() => setCell({ ...c, st, r })}
                style={{ flex: 1, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: cell?.period === c.period && cell?.r.unit_id === r.unit_id ? colors.surfaceTertiary : "transparent" }}>
                <Ionicons name={KIND_ICON[st.kind] as any} size={22} color={kindColor(colors, st.kind)} />
              </Pressable>
            );
          })}
        </Row>
      ))}
      {cell ? <View testID="grid-detail" style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, gap: 4 }}>
        <Txt v="label">{cell.r.label} · {g.periods.find((p: any) => p.period === cell.period)?.label}</Txt>
        <Status kind={cell.st.kind} label={cell.st.label} size="sm" />
        {cell.due ? <Txt v="body">{money(cell.paid)} of {money(cell.due)}</Txt> : null}
      </View> : null}
    </Card>
  );
}

const CATS = ["Insurance", "Taxes", "Mortgage interest", "Utilities", "Cleaning and maintenance", "Supplies", "Other"];

export default function Money() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const ov = useLive<any>(() => api("/money/overview"), 3000);
  const bank = useLive<any>(() => api("/money/bank"), 3000);
  const plaid = useLive<any>(() => api("/plaid/status"), 0);
  const [linking, setLinking] = useState(false);
  const [sheet, setSheet] = useState<null | "connect" | "plaidsim" | "expense" | "cash" | { assign: any }>(null);
  const connectPlaid = async () => {
    setLinking(true);
    try {
      const r = await api("/plaid/link/start", { method: "POST" });
      await WebBrowser.openBrowserAsync(r.hosted_link_url);
      // Hosted Link has no callback: check the session until Plaid reports it finished.
      for (let i = 0; i < 20; i++) {
        const s = await api(`/plaid/link/status/${r.link_token}`);
        if (s.status === "success") { toast("Bank connected — deposits imported"); setSheet(null); reload(); plaid.reload(); return; }
        if (s.status === "exit") { toast("Bank connection cancelled", "error"); return; }
        await new Promise((res) => setTimeout(res, 3000));
      }
      toast("Still waiting on Plaid — open Connect again to retry", "error");
    } catch (e: any) { toast(e.message, "error"); } finally { setLinking(false); }
  };
  const [f, setF] = useState<any>({});
  const [cash, setCash] = useState<any>(null);
  const reload = () => { ov.reload(); bank.reload(); };
  const run = async (fn: () => Promise<any>, msg: string) => { try { await fn(); toast(msg); setSheet(null); setF({}); reload(); } catch (e: any) { toast(e.message, "error"); } };
  const d = ov.data;
  const rooms = (d?.properties || []).flatMap((p: any) => p.units.filter((u: any) => u.tenant_name).map((u: any) => ({ ...u, pname: p.property.name })));
  return (
    <Screen tab testID="money-screen" refresh={<RefreshControl refreshing={false} onRefresh={reload} />}>
      <LargeHeader title="Money"
        actions={[{ label: "Record cash", icon: "cash-outline", onPress: () => setSheet("cash"), testID: "record-cash-button" }]} />
      {ov.error ? <ErrorState message={ov.error} onRetry={reload} /> : null}
      {!d ? <Skeleton /> : (
        <>
          <Card style={{ flexDirection: "row", gap: spacing.lg, marginBottom: spacing.xl }}>
            <View style={{ flex: 1 }}><BigNumber value={d.collected} sign={d.collected ? "in" : undefined} caption={`Collected · ${d.month}`} small /></View>
            <View style={{ flex: 1 }}><BigNumber value={d.overdue} color={d.overdue ? colors.you : colors.none} caption="Late" small /></View>
          </Card>
          <Section title="Rent history" testID="rent-grid-section"><RentGrid /></Section>
          <Section title="This month" testID="money-month-section">
            {d.properties.map((p: any, i: number) => (
              <Card key={p.property.id} index={i} testID={`money-property-${p.property.id}`}>
                <Row style={{ justifyContent: "space-between" }}>
                  <Txt v="label">{p.property.name}</Txt>
                  <TextButton testID={`year-report-${p.property.id}`} label={`Tax summary ${new Date().getFullYear()} ›`} onPress={() => router.push(`/report/${p.property.id}`)} />
                </Row>
                {p.units.map((u: any) => (
                  <View key={u.unit.id}>
                    <Divider />
                    <Row style={{ justifyContent: "space-between" }}>
                      <View style={{ flex: 1 }}>
                        <Txt v="body">{u.unit.label} · {u.tenant_name || "Vacant"}</Txt>
                        {u.month ? <Txt v="small">{money(u.month.paid)} of {money(u.month.due)}{u.overdue ? ` · ${money(u.overdue)} overdue` : ""}</Txt> : null}
                      </View>
                      {u.month ? <Status size="sm" testID={`rent-status-${u.unit.id}`} {...statusOf({ ...u.month, status: u.overdue ? "overdue" : u.month.status, due_day: u.unit.due_day }, "landlord", "rent")} /> : null}
                    </Row>
                  </View>
                ))}
              </Card>
            ))}
            {!d.properties.length ? <EmptyState testID="money-empty" icon="leaf-outline" title="No rent yet" /> : null}
          </Section>

          <Section title="Payouts" testID="payout-section"><BankCard role="landlord" testID="payout-bank" /></Section>

          <Section title="Bank feed" testID="bank-section" right={<StatusPill label={plaid.data?.items?.length ? "Plaid Sandbox" : "Simulated"} tone={plaid.data?.items?.length ? "brand" : "neutral"} />}>
            {!bank.data?.connected ? (
              <EmptyState testID="bank-connect-empty" icon="card-outline" title="Connect your bank" action="Connect bank" onAction={() => setSheet("connect")} />
            ) : (
              <>
                <Txt v="small">Connected ({bank.data.bank_name}){plaid.data?.items?.[0]?.last_sync ? ` · synced ${ago(plaid.data.items[0].last_sync)}` : ""}</Txt>
                {plaid.data?.items?.length ? (
                  <Row>
                    <BigButton style={{ flex: 1 }} testID="plaid-sync-button" tone="soft" icon="sync-outline" label="Sync now" onPress={async () => { try { const r = await api("/plaid/sync", { method: "POST" }); toast(r.imported ? `${r.imported} new deposit(s) imported` : "Bank synced — nothing new"); reload(); } catch (e: any) { toast(e.message, "error"); } }} />
                    <BigButton style={{ flex: 1 }} testID="plaid-sandbox-deposit-button" tone="soft" icon="add-circle-outline" label="Test deposit" onPress={() => setSheet("plaidsim")} />
                  </Row>
                ) : null}
                {!plaid.data?.items?.length && plaid.data?.configured ? <TextButton testID="plaid-upgrade-button" icon="lock-closed-outline" label="Connect a bank with Plaid" onPress={() => setSheet("connect")} /> : null}
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
                      <View style={{ flex: 1 }}><Txt v="body">{t.sender_name}</Txt><Txt v="small">{t.date.slice(0, 10)} · {t.category ? `${t.category[0].toUpperCase()}${t.category.slice(1)} · ` : ""}{t.status === "matched" ? "Matched to rent" : t.status === "history" ? "Imported from bank" : "Not rent"}{t.source === "plaid" ? " · Plaid" : t.source === "plaid_transfer" ? " · Plaid transfer" : ""}</Txt></View>
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
                      <View style={{ flex: 1 }}><IconRow icon={CAT_ICON[e.category] || "receipt"} label={e.description || e.category} value={money(e.amount)} /></View>
                    </Row>
                  </View>
                ))}
              </Card>
            ) : <EmptyState testID="expenses-empty" icon="leaf-outline" title="No expenses yet" />}
          </Section>
        </>
      )}

      <Sheet visible={sheet === "connect"} onClose={() => setSheet(null)} title="Connect your bank" testID="bank-connect-sheet">
        {plaid.data?.configured ? (
          <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
            <BigButton testID="plaid-connect-button" icon="lock-closed-outline" label="Connect with Plaid (Sandbox)" loading={linking} onPress={connectPlaid} />
            <Txt v="small">Sandbox login: user_transactions_dynamic / any password (lets you add test deposits). Fake money only.</Txt>
          </View>
        ) : <Txt v="small" style={{ marginBottom: spacing.md }}>Bank connection isn&apos;t set up yet. Tenant payments made in Doorman still show up here.</Txt>}
      </Sheet>
      <Sheet visible={sheet === "plaidsim"} onClose={() => setSheet(null)} title="Plaid Sandbox deposit" testID="plaid-sim-sheet">
        <View style={{ gap: spacing.md }}>
          <Field testID="plaid-sim-sender-input" label="Description" value={f.sender || ""} onChangeText={(v) => setF({ ...f, sender: v })} hint="Include the tenant's full name, e.g. Tom Chen rent" />
          <Field testID="plaid-sim-amount-input" label="Amount ($)" keyboardType="decimal-pad" value={f.amount || ""} onChangeText={(v) => setF({ ...f, amount: v })} />
          <BigButton testID="plaid-sim-submit" label="Send to Plaid" onPress={() => run(() => api("/plaid/sandbox/deposit", { body: { sender_name: f.sender, amount: Number(f.amount) } }), "Sent — tap Sync now in a few seconds")} />
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
