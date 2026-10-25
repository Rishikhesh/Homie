import React from "react";
import { RefreshControl, View } from "react-native";
import { api, money } from "@/src/api";
import { useLive } from "@/src/useLive";
import { openPdf } from "@/src/cards";
import { Card, Divider, EmptyState, ErrorState, LargeHeader, Row, Screen, Section, Skeleton, StatusPill, TextButton, Txt } from "@/src/ui";
import { PayButton } from "@/src/pay";
import { spacing, useTheme } from "@/src/theme";

const TONE: any = { paid: "success", due: "warning", overdue: "error", upcoming: "neutral" };

export default function Payments() {
  const { colors } = useTheme();
  const { data: d, error, loading, reload } = useLive<any>(() => api("/tenant/payments"), 3000);
  return (
    <Screen tab testID="tenant-payments-screen" refresh={<RefreshControl refreshing={false} onRefresh={reload} />}>
      <LargeHeader title="Payments" subtitle={d ? `${money(d.unit.rent)}/mo · due on day ${d.unit.due_day}` : undefined} />
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading && !d ? <Skeleton /> : d ? (
        <>
          {d.next_due || d.deposit_due ? (
            <View style={{ marginBottom: spacing.xl }}><PayButton due={d.next_due} deposit={d.deposit_due} onPaid={reload} landlord={d.landlord_name.split(" ")[0]} /></View>
          ) : <Card style={{ marginBottom: spacing.xl }} testID="all-paid-card"><Txt v="label">You&apos;re all paid up</Txt></Card>}
          {d.payment_details ? <Txt v="small" style={{ marginBottom: spacing.lg }}>Other ways to pay: {d.payment_details}</Txt> : null}
          <Section title="Month by month" testID="ledger-section">
            <Card>
              {d.ledger.map((r: any, i: number) => (
                <View key={r.period} testID={`ledger-row-${r.period}`}>
                  {i ? <Divider /> : null}
                  <Row style={{ justifyContent: "space-between" }}>
                    <View style={{ flex: 1 }}>
                      <Txt v="label">{r.month}</Txt>
                      <Txt v="small">{money(r.due)}{r.credits ? ` (rent ${money(r.rent)} ${r.credits > 0 ? "−" : "+"} ${money(Math.abs(r.credits))})` : ""}</Txt>
                    </View>
                    <StatusPill label={r.status[0].toUpperCase() + r.status.slice(1)} tone={TONE[r.status]} />
                  </Row>
                  {r.payment_ids.map((pid: string) => <TextButton key={pid} testID={`receipt-${pid}`} icon="document-text-outline" label="Receipt (PDF)" onPress={() => openPdf(`/receipts/${pid}.pdf`)} />)}
                </View>
              ))}
            </Card>
          </Section>
          <Section title="Credits & charges" testID="credits-section">
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
            ) : <EmptyState testID="credits-empty" title="No credits or charges" body="If your landlord approves a credit (like a repair you paid for), it shows here and comes off your next rent." />}
          </Section>
          <Section title="Deposit" testID="deposit-section">
            {d.payments.filter((p: any) => p.kind === "deposit").map((p: any) => (
              <Card key={p.id}><Row style={{ justifyContent: "space-between" }}><Txt v="body">Deposit held · {money(p.amount)}</Txt><TextButton testID={`deposit-receipt-${p.id}`} label="Receipt" onPress={() => openPdf(`/receipts/${p.id}.pdf`)} /></Row></Card>
            ))}
            {!d.payments.some((p: any) => p.kind === "deposit") ? <Txt v="small">{d.deposit_due ? `${money(d.deposit_due)} due` : "No deposit due yet"}</Txt> : null}
          </Section>
        </>
      ) : null}
    </Screen>
  );
}
