import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { api, money, authedUrl } from "@/src/api";
import { AgentMark, Avatar, BigButton, Card, ConfirmSheet, FileImage, ProgressDots, Row, StatusPill, TextButton, Txt, statusLabel, statusTone, useToast, Sheet, Field } from "@/src/ui";
import { spacing, useTheme } from "@/src/theme";

export function TicketRow({ t, role, index = 0, action }: { t: any; role: string; index?: number; action?: React.ReactNode }) {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <Card index={index} testID={`ticket-row-${t.id}`} onPress={() => router.push(`/ticket/${t.id}`)}>
      <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Txt v="label" style={{ fontSize: 17 }}>{t.urgency === "emergency" ? "⚠︎ " : ""}{t.title}</Txt>
          <Txt v="small">{role === "handyman" ? t.city : `${t.unit_label} · ${t.tenant_name}`}{role === "landlord" ? ` · ${t.property_name}` : ""}</Txt>
        </View>
        {t.handyman && role !== "handyman" ? (
          <View style={{ alignItems: "center", gap: 2 }}><Avatar name={t.handyman.name} size={34} /><Txt v="small" style={{ fontSize: 11 }}>{t.handyman.name.split(" ")[0]}</Txt></View>
        ) : null}
      </Row>
      <View style={{ marginTop: spacing.sm }}><StatusPill testID={`ticket-status-${t.id}`} label={statusLabel(t, role)} tone={statusTone(t)} /></View>
      {t.status !== "cancelled" ? <ProgressDots step={t.step} labels={role === "tenant" ? ["Reported", "Assigned", "Booked", "Fixed", "Confirmed"] : undefined} /> : null}
      {action ? <View style={{ marginTop: spacing.md }}>{action}</View> : null}
      {!action && role !== "landlord" ? null : null}
      <View style={{ height: 0 }}><Txt v="small" color={colors.muted}> </Txt></View>
    </Card>
  );
}

export function ApprovalCard({ a, onDone, index = 0 }: { a: any; onDone: () => void; index?: number }) {
  const { colors } = useTheme();
  const toast = useToast();
  const router = useRouter();
  const [confirm, setConfirm] = useState<null | { amount: number; option?: string; label: string }>(null);
  const [edit, setEdit] = useState(false);
  const [amt, setAmt] = useState(String(a.amount));
  const [busy, setBusy] = useState(false);
  const decide = async (action: string, amount?: number, option?: string) => {
    setBusy(true);
    try {
      await api(`/approvals/${a.id}/decide`, { body: { action, amount, option } });
      toast(action === "approve" ? "Approved" : "Declined");
      setConfirm(null); setEdit(false); onDone();
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  const isMoney = a.amount > 0;
  const over = a.kind === "reimbursement" && a.limit && a.amount > a.limit;
  const verb = a.kind === "handyman_payment" ? "Pay" : a.kind === "reimbursement" ? "Credit" : "Approve";
  const photos = [...(a.after_photos || []), ...(a.receipt_id ? [a.receipt_id] : [])];
  return (
    <Card agent index={index} testID={`approval-card-${a.id}`} style={a.urgent ? { borderColor: colors.error, borderWidth: 1.5 } : undefined}>
      <Row style={{ justifyContent: "space-between" }}>
        {a.urgent ? <StatusPill label="Urgent" tone="error" /> : <StatusPill label={a.ticket_title || "Needs you"} tone="brand" />}
        {a.ticket_id ? <TextButton testID={`approval-open-ticket-${a.id}`} label="Ticket ›" onPress={() => router.push(`/ticket/${a.ticket_id}`)} /> : null}
      </Row>
      <Txt v="label" style={{ fontSize: 17, marginTop: spacing.sm }}>{a.title}</Txt>
      {isMoney ? <Txt v="money" testID={`approval-amount-${a.id}`} style={{ marginVertical: 4 }}>{money(over ? a.limit : a.amount)}</Txt> : null}
      <Txt v="body" color={colors.muted}>{a.reason}</Txt>
      {photos.length ? <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>{photos.map((p: string) => <FileImage key={p} id={p} size={72} />)}</View> : null}
      {a.recommendation ? <View style={{ marginTop: spacing.sm, flexDirection: "row", gap: 6 }}><AgentMark small /><Txt v="small" style={{ flex: 1 }}>{a.recommendation.replace("✦ ", "")}</Txt></View> : null}
      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        {!isMoney ? (
          <BigButton testID={`approval-ack-${a.id}`} label="Got it" onPress={() => decide("approve")} loading={busy} />
        ) : over ? (
          <>
            <BigButton testID={`approval-limit-${a.id}`} label={`Credit ${money(a.limit)} only`} onPress={() => setConfirm({ amount: a.limit, option: "limit", label: `Credit ${money(a.limit)}` })} />
            <BigButton testID={`approval-full-${a.id}`} tone="soft" label={`Approve full ${money(a.amount)}`} onPress={() => setConfirm({ amount: a.amount, option: "full", label: `Credit ${money(a.amount)}` })} />
          </>
        ) : (
          <BigButton testID={`approval-approve-${a.id}`} label={a.kind === "self_fix_limit" ? `Approve up to ${money(a.amount)}` : `${verb} ${money(a.amount)}`} onPress={() => setConfirm({ amount: a.amount, label: `${verb} ${money(a.amount)}` })} />
        )}
        {isMoney ? (
          <Row style={{ justifyContent: "space-between" }}>
            {!over ? <TextButton testID={`approval-change-${a.id}`} label="Change amount" onPress={() => setEdit(true)} /> : <View />}
            <TextButton testID={`approval-decline-${a.id}`} label="Decline" color={colors.error} onPress={() => decide("decline")} />
          </Row>
        ) : null}
      </View>
      <ConfirmSheet visible={!!confirm} onClose={() => setConfirm(null)} title={`${confirm?.label}?`} amount={confirm?.amount} body="Simulated — no real money moves." confirmLabel={confirm?.label || "Confirm"} loading={busy}
        onConfirm={() => decide("approve", confirm!.amount, confirm!.option)} testID={`approval-confirm-${a.id}`} />
      <Sheet visible={edit} onClose={() => setEdit(false)} title="Change amount" testID={`approval-edit-${a.id}`}>
        <Field testID={`approval-edit-input-${a.id}`} label="Amount ($)" keyboardType="decimal-pad" value={amt} onChangeText={setAmt} />
        <BigButton testID={`approval-edit-save-${a.id}`} style={{ marginTop: spacing.lg }} label={`Approve ${money(Number(amt) || 0)}`} onPress={() => { setEdit(false); setConfirm({ amount: Number(amt) || 0, label: `${verb} ${money(Number(amt) || 0)}` }); }} />
      </Sheet>
    </Card>
  );
}

export function openPdf(path: string) {
  WebBrowser.openBrowserAsync(authedUrl(path));
}
