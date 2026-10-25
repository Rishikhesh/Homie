import React from "react";
import { RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { api, money } from "@/src/api";
import { useLive } from "@/src/useLive";
import { openPdf } from "@/src/cards";
import { Card, Divider, EmptyState, ErrorState, LargeHeader, Row, Screen, Section, Skeleton, TextButton, Txt } from "@/src/ui";
import { PayButton } from "@/src/pay";
import { BigNumber, DocTile, Status, StripCard } from "@/src/visual";
import { statusOf } from "@/src/status";
import { spacing, useTheme } from "@/src/theme";
import { BankCard } from "@/src/bank";


function StatementCard() {
  const router = useRouter();
  const { data: x } = useLive<any>(() => api("/inspections/mine"), 10000);
  if (!x?.statement) return null;
  return (
    <StripCard kind="good" testID="moveout-statement-card" style={{ marginBottom: spacing.xl, gap: spacing.sm }} onPress={() => router.push(`/statement/${x.statement.id}`)}>
      <BigNumber value={x.statement.refund} sign="in" caption="Deposit back" />
      {x.statement.total_deductions ? <Status kind="none" label={`${money(x.statement.total_deductions)} kept from deposit`} size="sm" /> : null}
      <Txt v="label">Move-out summary ›</Txt>
    </StripCard>
  );
}

export default function Payments() {
  const { colors } = useTheme();
  const { data: d, error, loading, reload } = useLive<any>(() => api("/tenant/payments"), 3000);
  return (
    <Screen tab testID="tenant-payments-screen" refresh={<RefreshControl refreshing={false} onRefresh={reload} />}>
      <LargeHeader title="Payments" />
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading && !d ? <Skeleton /> : d ? (
        <>
          {d.next_due || d.deposit_due ? (
            <StripCard kind={statusOf(d.next_due ? { ...d.next_due, due_day: d.unit.due_day } : null, "tenant", "rent").kind} style={{ marginBottom: spacing.xl, gap: spacing.sm }}>
              <BigNumber value={d.next_due ? d.next_due.remaining : d.deposit_due} caption={d.next_due ? `${d.next_due.month.split(" ")[0]} rent` : "Deposit"} />
              {d.next_due ? <Status {...statusOf({ ...d.next_due, due_day: d.unit.due_day }, "tenant", "rent")} /> : null}
              <PayButton due={d.next_due} deposit={d.deposit_due} onPaid={reload} landlord={d.landlord_name.split(" ")[0]} />
            </StripCard>
          ) : <StripCard kind="good" style={{ marginBottom: spacing.xl }} testID="all-paid-card"><Status kind="good" label="All paid" /></StripCard>}
          <StatementCard />
          {d.payment_details ? <Txt v="small" style={{ marginBottom: spacing.lg }}>Other ways to pay: {d.payment_details}</Txt> : null}
          <Section title="Your bank" testID="tenant-bank-section"><BankCard role="tenant" testID="tenant-bank" /></Section>
          <Section title="Rent history" testID="ledger-section">
            <Card>
              {d.ledger.map((r: any, i: number) => (
                <View key={r.period} testID={`ledger-row-${r.period}`}>
                  {i ? <Divider /> : null}
                  <Row style={{ justifyContent: "space-between" }}>
                    <View style={{ flex: 1 }}>
                      <Txt v="label">{r.month.split(" ")[0]}</Txt>
                      <Txt v="small">{money(r.due)}{r.credits ? ` · ${money(Math.abs(r.credits))} ${r.credits > 0 ? "off" : "added"}` : ""}</Txt>
                    </View>
                    <Status size="sm" {...statusOf({ ...r, due_day: d.unit.due_day }, "tenant", "rent")} />
                  </Row>
                  {r.payment_ids.map((pid: string) => <TextButton key={pid} testID={`receipt-${pid}`} icon="document-text-outline" label={`Receipt ${r.month.split(" ")[0]}`} onPress={() => openPdf(`/receipts/${pid}.pdf`)} />)}
                </View>
              ))}
            </Card>
          </Section>
          <Section title="Off next rent" testID="credits-section">
            {d.credits.length ? (
              <Card>
                {d.credits.map((c: any, i: number) => (
                  <View key={c.id}>{i ? <Divider /> : null}
                    <Row style={{ justifyContent: "space-between" }}>
                      <View style={{ flex: 1 }}><Txt v="body">{c.reason}</Txt><Txt v="small">Applies to {c.period}</Txt></View>
                      <Txt v="label" color={c.amount > 0 ? colors.onSuccessSoft : colors.error}>{c.amount > 0 ? "−" : "+"}{money(Math.abs(c.amount))}</Txt>
                    </Row>
                  </View>
                ))}
              </Card>
            ) : <EmptyState testID="credits-empty" icon="leaf-outline" title="Nothing yet" />}
          </Section>
          <Section title="Deposit" testID="deposit-section">
            {d.payments.filter((p: any) => p.kind === "deposit").map((p: any) => (
              <Card key={p.id} style={{ gap: spacing.sm }}><BigNumber value={p.amount} sign="held" caption="Deposit held" small /><DocTile testID={`deposit-receipt-${p.id}`} name="Deposit receipt" icon="receipt" onView={() => openPdf(`/receipts/${p.id}.pdf`)} /></Card>
            ))}
            {!d.payments.some((p: any) => p.kind === "deposit") ? <Txt v="small">{d.deposit_due ? `${money(d.deposit_due)} due` : "No deposit due yet"}</Txt> : null}
          </Section>
        </>
      ) : null}
    </Screen>
  );
}
