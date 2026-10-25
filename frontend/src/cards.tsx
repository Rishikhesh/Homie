import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import Animated, { FadeOutLeft } from "react-native-reanimated";
import { api, money, authedUrl } from "@/src/api";
import { BigButton, ConfirmSheet, FileImage, Ionicons, Row, TextButton, Txt, useToast, Sheet, Field } from "@/src/ui";
import { BigNumber, More, PersonChip, REPAIR_STEPS, Status, StripCard, Tracker, burst, tradeIcon } from "@/src/visual";
import { Role, statusOf } from "@/src/status";
import { repairCurrent } from "@/src/chatcards";
import { spacing, useTheme } from "@/src/theme";

/** One repair in a list: trade icon, short title, compact tracker, status. */
export function TicketRow({ t, role, index = 0, action }: { t: any; role: string; index?: number; action?: React.ReactNode }) {
  const router = useRouter();
  const { colors } = useTheme();
  const st = statusOf(t, role as Role);
  return (
    <StripCard kind={st.kind} index={index} testID={`ticket-row-${t.id}`} onPress={() => router.push(`/ticket/${t.id}`)}>
      <Row style={{ alignItems: "flex-start" }}>
        <Ionicons name={(t.urgency === "emergency" ? "warning" : tradeIcon(t.trade)) as any} size={20} color={t.urgency === "emergency" ? colors.you : colors.brandPrimary} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt v="label" style={{ fontSize: 16 }} numberOfLines={1}>{t.title}</Txt>
          <Txt v="small" numberOfLines={1}>{role === "handyman" ? t.city : role === "landlord" ? `${t.unit_label} · ${t.tenant_name?.split(" ")[0] || ""}` : t.handyman ? t.handyman.name.split(" ")[0] : ""}</Txt>
        </View>
      </Row>
      {t.status !== "cancelled" ? <Tracker steps={REPAIR_STEPS} current={repairCurrent(t)} mine={st.kind === "you"} compact /> : null}
      <View style={{ marginTop: spacing.sm }}><Status testID={`ticket-status-${t.id}`} kind={st.kind} label={st.label} size="sm" /></View>
      {action ? <View style={{ marginTop: spacing.md }}>{action}</View> : null}
    </StripCard>
  );
}

const HIGH = /high|above|more than|over the|pricey|expensive|check/i;

/** "Needs your OK": BigNumber, what in a few words, Homi's one-line view, big OK, text-link No. */
export function ApprovalCard({ a, onDone, index = 0 }: { a: any; onDone: () => void; index?: number }) {
  const { colors } = useTheme();
  const toast = useToast();
  const router = useRouter();
  const [confirm, setConfirm] = useState<null | { amount: number; option?: string; label: string }>(null);
  const [edit, setEdit] = useState(false);
  const [gone, setGone] = useState(false);
  const [amt, setAmt] = useState(String(a.amount));
  const [busy, setBusy] = useState(false);
  const decide = async (action: string, amount?: number, option?: string) => {
    setBusy(true);
    try {
      await api(`/approvals/${a.id}/decide`, { body: { action, amount, option } });
      if (action === "approve") burst("OK"); else toast("Said no");
      setConfirm(null); setEdit(false); setGone(true); setTimeout(onDone, 350);
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  if (gone) return null;
  const isMoney = a.amount > 0;
  const over = a.kind === "reimbursement" && a.limit && a.amount > a.limit;
  const verb = a.kind === "handyman_payment" ? "OK to pay" : a.kind === "reimbursement" ? "OK, pay back" : a.kind === "drop_charge" ? "OK, drop it" : a.kind === "deposit_statement" ? "Refund" : "OK";
  const photos = [...(a.after_photos || []), ...(a.receipt_id ? [a.receipt_id] : [])];
  const rec = (a.recommendation || "").replace("✦ ", "");
  const what = [a.ticket_title || a.title, a.handyman_name?.split(" ")[0]].filter(Boolean).join(" · ");
  return (
    <Animated.View exiting={FadeOutLeft.duration(300)}>
      <StripCard kind="you" index={index} testID={`approval-card-${a.id}`}>
        <View style={{ gap: spacing.sm }}>
          <Row style={{ justifyContent: "space-between" }}>
            <Status kind="you" label={a.urgent ? "Urgent" : "Needs your OK"} size="sm" />
            {a.ticket_id ? <TextButton testID={`approval-open-ticket-${a.id}`} label="Repair ›" onPress={() => router.push(`/ticket/${a.ticket_id}`)} /> : null}
          </Row>
          {isMoney ? <BigNumber testID={`approval-amount-${a.id}`} value={over ? a.limit : a.amount} /> : null}
          <Txt v="label" style={{ fontSize: 16 }} numberOfLines={2}>{what || a.title}</Txt>
          {a.handyman ? <PersonChip name={a.handyman.name} rating={a.handyman.rating_avg} /> : null}
          {rec ? <Row style={{ gap: 6 }}><Ionicons name="sparkles" size={16} color={HIGH.test(rec) ? colors.waiting : colors.good} /><Txt v="label" numberOfLines={2} style={{ flex: 1 }} color={HIGH.test(rec) ? colors.waiting : colors.good}>{rec}</Txt></Row> : null}
          {a.kind === "deposit_statement" ? (
            <BigButton testID={`approval-review-statement-${a.id}`} label="See move-out summary" onPress={() => router.push(`/statement/${a.statement_id}`)} />
          ) : a.kind === "start_move_out" ? (
            <BigButton testID={`approval-start-moveout-${a.id}`} label="Start move-out" onPress={() => decide("approve")} loading={busy} />
          ) : !isMoney ? (
            <BigButton testID={`approval-ack-${a.id}`} label="Got it" onPress={() => decide("approve")} loading={busy} />
          ) : over ? (
            <>
              <BigButton testID={`approval-limit-${a.id}`} label={`Pay back ${money(a.limit)} only`} onPress={() => setConfirm({ amount: a.limit, option: "limit", label: `Pay back ${money(a.limit)}` })} />
              <BigButton testID={`approval-full-${a.id}`} tone="soft" label={`OK full ${money(a.amount)}`} onPress={() => setConfirm({ amount: a.amount, option: "full", label: `Pay back ${money(a.amount)}` })} />
            </>
          ) : (
            <BigButton testID={`approval-approve-${a.id}`} label={a.kind === "self_fix_limit" ? `OK up to ${money(a.amount)}` : verb} onPress={() => setConfirm({ amount: a.amount, label: `${verb} ${money(a.amount)}` })} />
          )}
          {a.kind === "start_move_out" ? <TextButton testID={`approval-decline-${a.id}`} label="Not now" color={colors.you} onPress={() => decide("decline")} /> : null}
          {isMoney && a.kind !== "deposit_statement" ? (
            <Row style={{ justifyContent: "space-between" }}>
              {!over ? <TextButton testID={`approval-change-${a.id}`} label="Change amount" onPress={() => setEdit(true)} /> : <View />}
              <TextButton testID={`approval-decline-${a.id}`} label="No" color={colors.you} onPress={() => decide("decline")} />
            </Row>
          ) : null}
          {a.reason || photos.length ? (
            <More testID={`approval-more-${a.id}`}>
              {a.reason ? <Txt v="body">{a.reason}</Txt> : null}
              {photos.length ? <View style={{ flexDirection: "row", gap: spacing.sm }}>{photos.map((p: string) => <FileImage key={p} id={p} size={80} />)}</View> : null}
            </More>
          ) : null}
        </View>
        <ConfirmSheet visible={!!confirm} onClose={() => setConfirm(null)} title={`${confirm?.label}?`} amount={confirm?.amount} body="Simulated. No real money moves." confirmLabel={confirm?.label || "OK"} loading={busy}
          onConfirm={() => decide("approve", confirm!.amount, confirm!.option)} testID={`approval-confirm-${a.id}`} />
        <Sheet visible={edit} onClose={() => setEdit(false)} title="Change amount" testID={`approval-edit-${a.id}`}>
          <Field testID={`approval-edit-input-${a.id}`} label="Amount ($)" keyboardType="decimal-pad" value={amt} onChangeText={setAmt} />
          <BigButton testID={`approval-edit-save-${a.id}`} style={{ marginTop: spacing.lg }} label={`OK ${money(Number(amt) || 0)}`} onPress={() => { setEdit(false); setConfirm({ amount: Number(amt) || 0, label: `${verb} ${money(Number(amt) || 0)}` }); }} />
        </Sheet>
      </StripCard>
    </Animated.View>
  );
}

export function openPdf(path: string) {
  WebBrowser.openBrowserAsync(authedUrl(path));
}
