import React, { useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, money, ago } from "@/src/api";
import { useLive } from "@/src/useLive";
import { useAuth } from "@/src/auth";
import { ApprovalCard } from "@/src/cards";
import { RateCard } from "@/src/chat";
import { DateTimeField, PhotoButtons, PhotoStrip } from "@/src/inputs";
import { AgentMark, Avatar, BigButton, Card, Chip, ChipRow, ConfirmSheet, ErrorState, Field, FileImage, Ionicons, LargeHeader, ProgressDots, Row, Screen, Section, Sheet, Skeleton, StatusPill, TextButton, Txt, statusLabel, statusTone, useToast } from "@/src/ui";
import { spacing, useTheme } from "@/src/theme";

const pad = (n: number) => String(n).padStart(2, "0");
// Wall-clock time as picked; the server reads it in the property's time zone.
const wall = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

function AcceptSheet({ t, visible, onClose, onDone }: any) {
  const toast = useToast();
  const [quote, setQuote] = useState("");
  const [slots, setSlots] = useState<(Date | null)[]>([null, null, null]);
  const [busy, setBusy] = useState(false);
  const ok = Number(quote) > 0 && slots.filter(Boolean).length >= 2;
  return (
    <Sheet visible={visible} onClose={onClose} title="Accept this job" testID="accept-sheet">
      <View style={{ gap: spacing.lg }}>
        <Field testID="accept-quote-input" label="Your price ($)" keyboardType="decimal-pad" value={quote} onChangeText={setQuote} hint="The owner approves this before the visit" />
        {slots.map((s, i) => <DateTimeField key={i} testID={`accept-slot-${i}`} label={`Time option ${i + 1}${i === 2 ? " (optional)" : ""}`} value={s} onChange={(d) => setSlots(slots.map((x, j) => (j === i ? d : x)))} />)}
        <BigButton testID="accept-submit" label="Send quote & times" disabled={!ok} loading={busy} onPress={async () => {
          setBusy(true);
          try { await api(`/tickets/${t.id}/accept`, { body: { quote: Number(quote), slots: slots.filter(Boolean).map((d) => wall(d as Date)) } }); toast("Sent! Rentwise will confirm the visit"); onDone(); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
        }} />
      </View>
    </Sheet>
  );
}

function FixedSheet({ t, visible, onClose, onDone }: any) {
  const toast = useToast();
  const [price, setPrice] = useState(String(t.quote || ""));
  const [after, setAfter] = useState<string | null>(null);
  const [rec, setRec] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet visible={visible} onClose={onClose} title="Mark fixed" testID="fixed-sheet">
      <View style={{ gap: spacing.lg }}>
        <Field testID="fixed-price-input" label="Final price ($)" keyboardType="decimal-pad" value={price} onChangeText={setPrice} />
        <PhotoButtons testID="fixed-after" label="After photo" onUploaded={setAfter} />
        {after ? <FileImage id={after} size={90} /> : null}
        <PhotoButtons testID="fixed-receipt" label="Receipt (optional)" onUploaded={setRec} />
        <BigButton testID="fixed-submit" label="Mark fixed" disabled={!after || !Number(price)} loading={busy} onPress={async () => {
          setBusy(true);
          try { await api(`/tickets/${t.id}/mark-fixed`, { body: { final_amount: Number(price), after_photo_id: after, receipt_id: rec } }); toast("Marked fixed — tenant is checking"); onDone(); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
        }} />
      </View>
    </Sheet>
  );
}

function ReceiptSheet({ t, visible, onClose, onDone }: any) {
  const toast = useToast();
  const [rec, setRec] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Sheet visible={visible} onClose={onClose} title="Send receipt & after photo" testID="receipt-sheet">
      <View style={{ gap: spacing.lg }}>
        <Txt v="body">You&apos;re approved for up to {money(t.approved_amount)}.</Txt>
        <PhotoButtons testID="receipt-photo" label="Receipt" onUploaded={setRec} />
        <PhotoButtons testID="receipt-after" label="After photo" onUploaded={setAfter} />
        <PhotoStrip ids={[rec, after].filter(Boolean) as string[]} />
        <Field testID="receipt-amount-input" label="Receipt total ($)" keyboardType="decimal-pad" value={amt} onChangeText={setAmt} hint="Rentwise also reads the total from the photo" />
        <BigButton testID="receipt-submit" label="Send for approval" disabled={!rec || !after} loading={busy} onPress={async () => {
          setBusy(true);
          try { await api(`/tickets/${t.id}/receipt`, { body: { receipt_id: rec, after_photo_id: after, amount: amt ? Number(amt) : null } }); toast("Sent for approval"); onDone(); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
        }} />
      </View>
    </Sheet>
  );
}

export default function TicketDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { me } = useAuth();
  const role = me?.user?.role;
  const { colors } = useTheme();
  const toast = useToast();
  const { data: t, error, reload } = useLive<any>(() => api(`/tickets/${id}`), 3000, [id]);
  const [sheet, setSheet] = useState<null | "accept" | "fixed" | "receipt" | "decline" | "selffix">(null);
  if (error && !t) return <Screen><LargeHeader title="Ticket" back={() => router.back()} /><ErrorState message={error} onRetry={reload} /></Screen>;
  if (!t) return <Screen><Skeleton /></Screen>;
  const act = async (path: string, body?: any, msg = "Done") => { try { await api(`/tickets/${id}/${path}`, { body: body || {} }); toast(msg); setSheet(null); reload(); } catch (e: any) { toast(e.message, "error"); } };
  const photos = [...(t.photos || []), ...(t.after_photos || [])];
  const preBook = ["finding_handyman", "offered", "awaiting_tenant_time"].includes(t.status);

  let primary: React.ReactNode = null;
  if (role === "handyman" && t.status === "offered") primary = <><BigButton testID="ticket-accept-button" label="Accept with a quote" onPress={() => setSheet("accept")} /><TextButton testID="ticket-decline-button" label="Decline" color={colors.error} onPress={() => setSheet("decline")} /></>;
  else if (role === "handyman" && t.status === "booked") primary = <BigButton testID="ticket-mark-fixed-button" label="Mark fixed" icon="checkmark-circle-outline" onPress={() => setSheet("fixed")} />;
  else if (role === "tenant" && t.status === "fixed_pending_confirm") primary = <Row><BigButton style={{ flex: 1 }} testID="ticket-confirm-yes" icon="thumbs-up" label="It works" onPress={() => act("confirm", { ok: true }, "Thanks!")} /><BigButton style={{ flex: 1 }} tone="soft" testID="ticket-confirm-no" icon="thumbs-down" label="Not yet" onPress={() => act("confirm", { ok: false }, "Asking them to come back")} /></Row>;
  else if (role === "tenant" && t.status === "self_fix_approved") primary = <BigButton testID="ticket-upload-receipt" label="Upload receipt & after photo" icon="receipt-outline" onPress={() => setSheet("receipt")} />;

  return (
    <Screen testID="ticket-detail-screen" refresh={<RefreshControl refreshing={false} onRefresh={reload} />}>
      <LargeHeader title={t.title} subtitle={role === "handyman" ? t.city : `${t.unit_label} · ${t.tenant_name} · ${t.property_name}`} back={() => router.back()} />
      {photos.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.lg }} contentContainerStyle={{ gap: spacing.sm }}>{photos.map((p: string) => <FileImage key={p} id={p} size={150} testID={`ticket-photo-${p}`} />)}</ScrollView> : null}
      <Card style={{ marginBottom: spacing.xl }} testID="ticket-status-card">
        <Row style={{ justifyContent: "space-between" }}>
          <StatusPill testID="ticket-status-pill" label={statusLabel(t, role)} tone={statusTone(t)} />
          {t.urgency !== "normal" ? <StatusPill label={t.urgency === "emergency" ? "Emergency" : "High priority"} tone="error" /> : null}
        </Row>
        <ProgressDots step={t.step} labels={role === "tenant" ? ["Reported", "Assigned", "Booked", "Fixed", "Confirmed"] : undefined} />
        <Txt v="body" style={{ marginTop: spacing.md }}>{t.description}</Txt>
        {t.handyman && role !== "handyman" ? <Row style={{ marginTop: spacing.md }}><Avatar name={t.handyman.name} size={36} /><View><Txt v="label">{t.handyman.name}</Txt><Txt v="small">★ {t.handyman.rating_avg?.toFixed?.(1)} · {t.handyman.trades.join(", ")}</Txt></View></Row> : null}
        {t.picked_slot ? <Txt v="label" style={{ marginTop: spacing.md }}>Visit: {t.picked_slot.label}</Txt> : null}
        {t.quote && role !== "tenant" ? <Txt v="small">Quote {money(t.quote)}{t.approved_amount && role === "landlord" ? ` · approved ${money(t.approved_amount)}` : ""}{t.final_amount ? ` · final ${money(t.final_amount)}` : ""}</Txt> : null}
        {role === "handyman" ? <Txt v="small" style={{ marginTop: spacing.sm }}>{t.address ? `Address: ${t.address}${t.access_notes ? ` · ${t.access_notes}` : ""}` : "Address shared once the visit is booked"}</Txt> : null}
      </Card>

      {role === "tenant" && t.status === "awaiting_tenant_time" ? (
        <Section title="Pick a time" testID="ticket-slots-section">
          <ChipRow>{(t.slots || []).map((s: any, i: number) => <Chip key={s.iso} testID={`ticket-slot-${i}`} icon="time-outline" label={s.label} selected={t.picked_slot?.iso === s.iso} onPress={() => act("pick-slot", { slot: s.iso }, `Picked ${s.label}`)} />)}</ChipRow>
        </Section>
      ) : null}
      {primary ? <View style={{ marginBottom: spacing.xl, gap: spacing.sm }}>{primary}</View> : null}
      {role === "landlord" && t.pending_approval ? <View style={{ marginBottom: spacing.xl }}><ApprovalCard a={{ ...t.pending_approval, after_photos: t.after_photos, receipt_id: t.receipt_path }} onDone={reload} /></View> : null}
      {role === "tenant" && ["payment_pending_approval", "closed"].includes(t.status) && t.handyman ? <Card style={{ marginBottom: spacing.xl }}><Txt v="label">Rate {t.handyman.name.split(" ")[0]}</Txt><RateCard ticketId={t.id} /></Card> : null}

      <Row style={{ flexWrap: "wrap", marginBottom: spacing.lg }}>
        {role === "landlord" && t.tenant_thread_id ? <TextButton testID="ticket-tenant-thread" icon="chatbubbles-outline" label={`Rentwise ↔ ${t.tenant_name.split(" ")[0]}`} onPress={() => router.push(`/thread/${t.tenant_thread_id}`)} /> : null}
        {role !== "tenant" && t.job_thread_id ? <TextButton testID="ticket-job-thread" icon="chatbubbles-outline" label={role === "handyman" ? "Chat with Rentwise" : `Rentwise ↔ ${t.handyman?.name?.split(" ")[0] || "handyman"}`} onPress={() => router.push(`/thread/${t.job_thread_id}`)} /> : null}
        {role === "tenant" ? <TextButton testID="ticket-tenant-chat" icon="chatbubbles-outline" label="Message Rentwise" onPress={() => router.push("/(tenant)/chat")} /> : null}
        {role === "tenant" && preBook ? <TextButton testID="ticket-self-fix" icon="hammer-outline" label="Fix it myself instead" onPress={() => setSheet("selffix")} /> : null}
      </Row>

      <Section title="Timeline" testID="ticket-timeline">
        <Card>
          {[...(t.timeline || [])].reverse().map((e: any, i: number) => (
            <Row key={i} style={{ alignItems: "flex-start", paddingVertical: spacing.sm }}>
              <Ionicons name={e.actor === "agent" ? "sparkles" : e.actor === "landlord" ? "person-circle-outline" : e.actor === "handyman" ? "construct-outline" : "person-outline"} size={18} color={colors.brandPrimary} style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}><Txt v="body">{e.text}</Txt><Txt v="small">{e.actor === "agent" ? "Rentwise ✦ · " : ""}{ago(e.at)}</Txt></View>
            </Row>
          ))}
        </Card>
      </Section>
      {role === "tenant" && !["closed", "cancelled"].includes(t.status) ? <AgentMark /> : null}

      <AcceptSheet t={t} visible={sheet === "accept"} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />
      <FixedSheet t={t} visible={sheet === "fixed"} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />
      <ReceiptSheet t={t} visible={sheet === "receipt"} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />
      <ConfirmSheet visible={sheet === "decline"} onClose={() => setSheet(null)} title="Decline this job?" body="Rentwise will offer it to someone else." confirmLabel="Decline" danger testID="decline-confirm" onConfirm={() => act("decline", {}, "Declined")} />
      <ConfirmSheet visible={sheet === "selffix"} onClose={() => setSheet(null)} title="Fix it yourself?" body="Rentwise checks a spending limit with the owner first. Don't pay anyone until it's approved — then the cost comes off your next rent." confirmLabel="Ask for a limit" testID="selffix-confirm" onConfirm={() => act("self-fix", {}, "Asked the owner for a limit")} />
    </Screen>
  );
}
