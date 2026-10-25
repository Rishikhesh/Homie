import React, { useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, money, ago } from "@/src/api";
import { useLive } from "@/src/useLive";
import { useAuth } from "@/src/auth";
import { ApprovalCard } from "@/src/cards";
import { RateCard } from "@/src/chat";
import { DateTimeField, PhotoButtons, PhotoStrip } from "@/src/inputs";
import { AgentMark, BigButton, Card, ConfirmSheet, ErrorState, Field, FileImage, Ionicons, LargeHeader, Row, Screen, Section, Sheet, Skeleton, TextButton, Txt, useToast } from "@/src/ui";
import { BigNumber, More, PersonChip, Status, TimeChoice, Tracker, YesNo, burst, fmtSlot, tradeIcon } from "@/src/visual";
import { Role, statusOf } from "@/src/status";
import { repairCurrent } from "@/src/chatcards";
import { radius, spacing, useTheme } from "@/src/theme";

const pad = (n: number) => String(n).padStart(2, "0");
// Wall-clock time as picked; the server reads it in the property's time zone.
const wall = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

const defaultSlot = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d; };

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"];
function NumberPad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { colors } = useTheme();
  const press = (k: string) => onChange(k === "del" ? value.slice(0, -1) : k === "." && value.includes(".") ? value : (value + k).replace(/^0+(?=\d)/, "").slice(0, 7));
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
      {KEYS.map((k) => (
        <Pressable key={k} testID={`pad-${k}`} accessibilityLabel={k === "del" ? "Delete" : k} onPress={() => press(k)}
          style={({ pressed }) => ({ width: "31%", flexGrow: 1, height: 56, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? colors.brandSecondary : colors.surfaceTertiary })}>
          {k === "del" ? <Ionicons name="backspace-outline" size={24} color={colors.onSurface} /> : <Txt weight="bold" style={{ fontSize: 24 }}>{k}</Txt>}
        </Pressable>
      ))}
    </View>
  );
}

const presetSlots = () => {
  const out: { iso: string; label: string }[] = [];
  for (const [d, h] of [[1, 10], [1, 14], [2, 10], [2, 14]]) { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, 0, 0, 0); out.push({ iso: wall(x), label: "" }); }
  return out;
};

function AcceptSheet({ t, visible, onClose, onDone }: any) {
  const toast = useToast();
  const [quote, setQuote] = useState("");
  const [presets] = useState(presetSlots);
  const [picked, setPicked] = useState<string | null>(null);
  const [slot, setSlot] = useState<Date>(defaultSlot);
  const [busy, setBusy] = useState(false);
  const chosen = picked || wall(slot);
  const ok = Number(quote) > 0 && new Date(chosen).getTime() > Date.now();
  return (
    <Sheet visible={visible} onClose={onClose} title="Take this job" testID="accept-sheet">
      <View style={{ gap: spacing.lg }}>
        <BigNumber value={`$${quote || "0"}`} caption="Your price · owner OKs it first" />
        <NumberPad value={quote} onChange={setQuote} />
        <Field testID="accept-quote-input" label="Or type the price" keyboardType="decimal-pad" value={quote} onChangeText={setQuote} />
        <Txt v="h2">When can you come?</Txt>
        <TimeChoice testIDPrefix="accept-time" slots={presets} picked={picked} onPick={(iso) => setPicked(iso)} />
        <More label="Other time" testID="accept-other-time">
          <DateTimeField testID="accept-slot" label="Pick a time" value={slot} onChange={(d: Date) => { setSlot(d); setPicked(null); }} />
        </More>
        <Txt v="small" testID="accept-slot-summary">Visit: {fmtSlot({ iso: chosen })}</Txt>
        <BigButton testID="accept-submit" label="Send price and time" disabled={!ok} loading={busy} onPress={async () => {
          setBusy(true);
          try { await api(`/tickets/${t.id}/accept`, { body: { quote: Number(quote), slots: [chosen] } }); burst("Sent"); onDone(); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
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
          try { await api(`/tickets/${t.id}/mark-fixed`, { body: { final_amount: Number(price), after_photo_id: after, receipt_id: rec } }); burst("Fixed"); onDone(); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
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
  if (error && !t) return <Screen><LargeHeader title="Repair" back={() => router.back()} /><ErrorState message={error} onRetry={reload} /></Screen>;
  if (!t) return <Screen><Skeleton /></Screen>;
  const act = async (path: string, body?: any, msg = "Done") => { try { await api(`/tickets/${id}/${path}`, { body: body || {} }); toast(msg); setSheet(null); reload(); } catch (e: any) { toast(e.message, "error"); } };
  const photos = [...(t.photos || []), ...(t.after_photos || [])];
  const preBook = ["finding_handyman", "offered", "awaiting_tenant_time"].includes(t.status);

  const st = statusOf(t, (role || "tenant") as Role);
  const done = async (path: string, body: any, label: string) => { try { await api(`/tickets/${id}/${path}`, { body }); burst(label); setSheet(null); reload(); } catch (e: any) { toast(e.message, "error"); } };
  let primary: React.ReactNode = null;
  if (role === "handyman" && t.status === "offered") primary = <><BigButton testID="ticket-accept-button" icon="checkmark-circle" label="Take job" onPress={() => setSheet("accept")} /><TextButton testID="ticket-decline-button" label="Can't" color={colors.you} onPress={() => setSheet("decline")} /></>;
  else if (role === "handyman" && t.status === "booked") primary = <BigButton testID="ticket-mark-fixed-button" label="Mark fixed" icon="checkmark-circle-outline" onPress={() => setSheet("fixed")} />;
  else if (role === "tenant" && t.status === "fixed_pending_confirm") primary = <><Txt v="h2">Is it fixed?</Txt><YesNo testIDPrefix="ticket-confirm" yes="It works" no="Not yet" onYes={() => done("confirm", { ok: true }, "Fixed")} onNo={() => act("confirm", { ok: false }, "Asking them to come back")} /></>;
  else if (role === "tenant" && t.status === "self_fix_approved") primary = <BigButton testID="ticket-upload-receipt" label="Send receipt and photo" icon="receipt-outline" onPress={() => setSheet("receipt")} />;
  const icon = (e: any) => (e.actor === "agent" ? "sparkles" : e.actor === "landlord" ? "person-circle" : e.actor === "handyman" ? "construct" : "person");

  return (
    <Screen testID="ticket-detail-screen" refresh={<RefreshControl refreshing={false} onRefresh={reload} />}>
      <LargeHeader title={t.title} subtitle={role === "handyman" ? t.city : `${t.unit_label} · ${t.tenant_name.split(" ")[0]}`} back={() => router.back()} />
      <Card style={{ marginBottom: spacing.xl, gap: spacing.md }} testID="ticket-status-card">
        {t.status !== "cancelled" ? <Tracker testID="ticket-tracker" current={repairCurrent(t)} mine={st.kind === "you"} /> : null}
        <Row style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <Status testID="ticket-status-pill" kind={st.kind} label={st.label} />
          {t.urgency !== "normal" ? <Status kind="you" size="sm" label={t.urgency === "emergency" ? "Emergency" : "Urgent"} /> : null}
        </Row>
        {t.handyman && role !== "handyman" ? <PersonChip testID="ticket-person" name={t.handyman.name} rating={t.handyman.rating_avg} trade={t.handyman.trades?.[0]} /> : null}
        {role === "handyman" ? <Row><Ionicons name={tradeIcon(t.trade) as any} size={22} color={colors.brandPrimary} /><Txt v="label">{t.address || "Address after booking"}</Txt></Row> : null}
        {t.picked_slot ? <Row><Ionicons name="calendar" size={22} color={colors.brandPrimary} /><Txt v="label" style={{ fontSize: 16 }}>{fmtSlot(t.picked_slot)}</Txt></Row> : null}
        {t.quote && role !== "tenant" ? <Row><Ionicons name="pricetag" size={22} color={colors.brandPrimary} /><Txt v="label" style={{ fontSize: 16 }}>{money(t.final_amount || t.approved_amount || t.quote)}</Txt><Txt v="small">{t.final_amount ? "final" : t.approved_amount ? "OK'd" : "price"}</Txt></Row> : null}
        <More testID="ticket-more">
          <Txt v="body">{t.description}</Txt>
          {photos.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>{photos.map((p: string) => <FileImage key={p} id={p} size={120} testID={`ticket-photo-${p}`} />)}</ScrollView> : null}
          {role === "handyman" && t.access_notes ? <Txt v="small">{t.access_notes}</Txt> : null}
        </More>
      </Card>

      {role === "tenant" && t.status === "awaiting_tenant_time" ? (
        <Section title="Pick a time" testID="ticket-slots-section">
          <TimeChoice testIDPrefix="ticket-slot" slots={t.slots || []} picked={t.picked_slot?.iso} onPick={(iso) => done("pick-slot", { slot: iso }, "Booked")} />
        </Section>
      ) : null}
      {primary ? <View style={{ marginBottom: spacing.xl, gap: spacing.sm }}>{primary}</View> : null}
      {role === "landlord" && t.pending_approval ? <View style={{ marginBottom: spacing.xl }}><ApprovalCard a={{ ...t.pending_approval, ticket_title: t.title, after_photos: t.after_photos, receipt_id: t.receipt_path }} onDone={reload} /></View> : null}
      {role === "tenant" && ["payment_pending_approval", "closed"].includes(t.status) && t.handyman ? <Card style={{ marginBottom: spacing.xl }}><Txt v="label">Rate {t.handyman.name.split(" ")[0]}</Txt><RateCard ticketId={t.id} /></Card> : null}

      <Row style={{ flexWrap: "wrap", marginBottom: spacing.lg }}>
        {role === "landlord" && t.tenant_thread_id ? <TextButton testID="ticket-tenant-thread" icon="chatbubbles-outline" label={`Conversation with ${t.tenant_name.split(" ")[0]} ›`} onPress={() => router.push(`/thread/${t.tenant_thread_id}`)} /> : null}
        {role !== "tenant" && t.job_thread_id ? <TextButton testID="ticket-job-thread" icon="chatbubbles-outline" label={role === "handyman" ? "Conversation ›" : `Conversation with ${t.handyman?.name?.split(" ")[0] || "handyman"} ›`} onPress={() => router.push(`/thread/${t.job_thread_id}`)} /> : null}
        {role === "tenant" ? <TextButton testID="ticket-tenant-chat" icon="chatbubbles-outline" label="Conversation ›" onPress={() => router.push("/(tenant)/chat")} /> : null}
        {role === "tenant" && preBook ? <TextButton testID="ticket-self-fix" icon="hammer-outline" label="Fix it myself" onPress={() => setSheet("selffix")} /> : null}
      </Row>

      <Section title="What happened" testID="ticket-timeline">
        <Card>
          {[...(t.timeline || [])].reverse().map((e: any, i: number) => (
            <Row key={i} style={{ alignItems: "center", paddingVertical: 6 }}>
              <Txt v="small" style={{ width: 64 }}>{ago(e.at)}</Txt>
              <Ionicons name={icon(e) as any} size={18} color={colors.brandPrimary} />
              <Txt v="body" style={{ flex: 1 }} numberOfLines={2}>{e.text}</Txt>
            </Row>
          ))}
        </Card>
      </Section>
      {role === "tenant" && !["closed", "cancelled"].includes(t.status) ? <AgentMark /> : null}

      <AcceptSheet t={t} visible={sheet === "accept"} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />
      <FixedSheet t={t} visible={sheet === "fixed"} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />
      <ReceiptSheet t={t} visible={sheet === "receipt"} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />
      <ConfirmSheet visible={sheet === "decline"} onClose={() => setSheet(null)} title="Can't take it?" body="Rentwise offers it to someone else." confirmLabel="Can't take it" danger testID="decline-confirm" onConfirm={async () => { try { await api(`/tickets/${id}/decline`, { body: {} }); toast("OK, it's in Missed"); setSheet(null); if (router.canGoBack()) router.back(); else router.replace("/(handyman)" as any); } catch (e: any) { toast(e.message, "error"); } }} />
      <ConfirmSheet visible={sheet === "selffix"} onClose={() => setSheet(null)} title="Fix it yourself?" body="The owner sets a limit first. Then it comes off your next rent." confirmLabel="Ask the owner" testID="selffix-confirm" onConfirm={() => act("self-fix", {}, "Asked the owner for a limit")} />
    </Screen>
  );
}
