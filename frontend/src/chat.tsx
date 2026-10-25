import React, { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, Switch, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { api, authedUrl, money } from "@/src/api";
import { useLive } from "@/src/useLive";
import { AgentMark, Chip, ChipRow, FileImage, Ionicons, Txt, useToast, TextButton } from "@/src/ui";
import { PhotoButtons, PhotoStrip } from "@/src/inputs";
import { fonts, radius, spacing, useTheme } from "@/src/theme";
import { useAuth } from "@/src/auth";
import { LIVE_TYPES, LiveCard } from "@/src/chatcards";
import { More } from "@/src/visual";
import { Role } from "@/src/status";
import { MicButton, SpeakButton, speak, stopSpeaking } from "@/src/voice";
import { storage } from "@/src/utils/storage";

const HANDS_FREE_KEY = "rw_hands_free";

export function RateCard({ ticketId }: { ticketId: string }) {
  const { data: t, reload } = useLive<any>(() => api(`/tickets/${ticketId}`), 0, [ticketId]);
  const { colors } = useTheme();
  const toast = useToast();
  if (!t) return null;
  return (
    <View style={{ flexDirection: "row", gap: 4, marginTop: spacing.sm }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} testID={`rate-star-${n}`} disabled={!!t.rating} hitSlop={4} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}
          onPress={async () => { try { await api(`/tickets/${ticketId}/rate`, { body: { stars: n } }); toast("Thanks for rating!"); reload(); } catch (e: any) { toast(e.message, "error"); } }}>
          <Ionicons name={(t.rating || 0) >= n ? "star" : "star-outline"} size={28} color={colors.brandPrimary} />
        </Pressable>
      ))}
      <Txt v="small" style={{ alignSelf: "center" }}>{t.rating ? "Rated" : "Tap to rate"}</Txt>
    </View>
  );
}

function CardView({ c, role, onAnswer }: { c: any; role: string; onAnswer?: (t: string) => void }) {
  const router = useRouter();
  switch (c.type) {
    case "rate": return <RateCard ticketId={c.ticket_id} />;
    case "receipt_request": return <TextButton testID={`chat-receipt-request-${c.ticket_id}`} icon="receipt-outline" label="Send receipt and photo ›" onPress={() => router.push(`/ticket/${c.ticket_id}`)} />;
    case "offer": return <TextButton testID={`chat-offer-${c.ticket_id}`} icon="construct-outline" label="Open job ›" onPress={() => router.push(`/ticket/${c.ticket_id}`)} />;
    case "receipt": return <LiveCard c={{ type: "repair", ref_id: c.ticket_id }} role={role as Role} />;
    case "payment_receipt": return <TextButton testID={`chat-receipt-${c.payment_id}`} icon="document-text-outline" label="View receipt (PDF)" onPress={() => WebBrowser.openBrowserAsync(authedUrl(`/receipts/${c.payment_id}.pdf`))} />;
    case "lease": return <TextButton testID="chat-open-lease" icon="document-text-outline" label="Open lease" onPress={() => router.push(`/lease/${c.lease_id}`)} />;
    case "call": return <TextButton testID={`chat-call-${c.call_id}`} icon="call-outline" label="Call transcript ›" onPress={() => router.push(`/call/${c.call_id}`)} />;
    case "statement": return <TextButton testID={`chat-statement-${c.statement_id}`} icon="document-text-outline" label="Open move-out summary ›" onPress={() => router.push(`/statement/${c.statement_id}`)} />;
    case "inspection": return <TextButton testID={`chat-inspection-${c.inspection_id}`} icon="videocam-outline" label="Start the check ›" onPress={() => router.push(`/inspection/${c.inspection_id}`)} />;
    default: return LIVE_TYPES.includes(c.type) ? <LiveCard c={c} role={role as Role} onAnswer={onAnswer} /> : null;
  }
}

export function Chat({ threadId, quickReplies = [], bottomPad = 0, readOnlyNote }: { threadId: string; quickReplies?: string[]; bottomPad?: number; readOnlyNote?: string }) {
  const { colors } = useTheme();
  const { me } = useAuth();
  const role = me?.user?.role || "tenant";
  const toast = useToast();
  const { data, reload } = useLive<any>(() => api(`/threads/${threadId}`), 3000, [threadId]);
  const [text, setText] = useState("");
  const [atts, setAtts] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  useEffect(() => () => stopSpeaking(), [threadId]); // stale narration never plays over the next screen
  const listRef = useRef<FlatList>(null);
  const msgs = data?.messages || [];
  const busy = data?.thread?.busy || sending;
  const canWrite = data?.can_write;
  useEffect(() => { listRef.current?.scrollToOffset({ offset: 0, animated: true }); }, [msgs.length]);

  // Hands-free: spoken messages send at once, and the reply that follows is read aloud.
  const [handsFree, setHandsFree] = useState(false);
  const waitingFor = useRef<Set<string> | null>(null); // message ids seen when we sent; null = not waiting
  useEffect(() => { storage.getItem(HANDS_FREE_KEY, false).then((v) => setHandsFree(!!v)); }, []);
  const toggleHandsFree = (v: boolean) => {
    setHandsFree(v); storage.setItem(HANDS_FREE_KEY, v);
    if (!v) { waitingFor.current = null; stopSpeaking(); }
  };
  useEffect(() => {
    const seen = waitingFor.current;
    if (!seen || busy) return;
    const reply = msgs.find((m: any) => !seen.has(m.id) && m.role !== "user" && m.role !== "system" && m.text); // first reply after the spoken message
    if (!reply) return;
    waitingFor.current = null;
    speak(reply.id, () => toast("Couldn't read the reply aloud. Tap the speaker to try again", "error")).catch(() => {});
  }, [data, busy, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (t?: string, spoken = false) => {
    const body = (t ?? text).trim();
    if (!body && !atts.length) return;
    setSending(true);
    if (spoken) waitingFor.current = new Set(msgs.map((m: any) => m.id));
    try {
      await api(`/threads/${threadId}/messages`, { body: { text: body, attachments: atts } });
      setText(""); setAtts([]); reload();
    } catch (e: any) { waitingFor.current = null; toast(e.message, "error"); } finally { setSending(false); }
  };
  const onSpoken = (t: string) => {
    if (handsFree) send(text.trim() ? `${text.trim()} ${t}` : t, true);
    else setText((cur) => (cur.trim() ? `${cur.trim()} ${t}` : t));
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={0}>
      {canWrite ? (
        <Pressable testID="hands-free-row" accessibilityRole="switch" accessibilityState={{ checked: handsFree }} onPress={() => toggleHandsFree(!handsFree)}
          style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 0.5, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
          <Ionicons name={handsFree ? "headset" : "headset-outline"} size={20} color={handsFree ? colors.brandPrimary : colors.muted} />
          <View style={{ flex: 1 }}>
            <Txt v="label">Hands-free</Txt>
            <Txt v="small">{handsFree ? "Speak, it sends, and the reply is read aloud" : "Turn on to talk and listen without typing"}</Txt>
          </View>
          <Switch testID="hands-free-switch" accessibilityLabel="Hands-free mode" value={handsFree} onValueChange={toggleHandsFree}
            trackColor={{ true: colors.brandPrimary, false: colors.surfaceTertiary }} />
        </Pressable>
      ) : null}
      <FlatList
        ref={listRef}
        testID="chat-messages"
        inverted
        data={[...msgs].reverse()}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        ListHeaderComponent={busy ? <View testID="chat-typing" style={{ alignSelf: "flex-start", padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.brandTertiary }}><AgentMark small /><Txt v="small">Rentwise is typing…</Txt></View> : undefined}
        renderItem={({ item: m }) => {
          const mine = m.role === "user" && m.sender_id === me?.user?.id;
          const user = m.role === "user";
          return (
            <View style={{ alignItems: user ? "flex-end" : "flex-start" }}>
              <View testID={`chat-msg-${m.id}`} style={{ maxWidth: m.cards?.length ? "100%" : "86%", width: m.cards?.length ? "100%" : undefined, padding: spacing.md, borderRadius: 18, borderBottomRightRadius: user ? 6 : 18, borderBottomLeftRadius: user ? 18 : 6,
                backgroundColor: user ? (mine ? colors.brandPrimary : colors.surfaceTertiary) : m.role === "system" ? colors.errorSoft : colors.surfaceSecondary, borderWidth: user ? 0 : 0.5, borderColor: colors.border }}>
                {!user ? <View style={{ marginBottom: 4 }}><AgentMark small /></View> : null}
                {m.text ? <Txt v="body" style={!user ? { fontFamily: fonts.medium } : undefined} color={user && mine ? colors.onBrandPrimary : undefined}>{m.text}</Txt> : null}
                {m.details ? <More testID={`chat-more-${m.id}`}><Txt v="body">{m.details}</Txt></More> : null}
                {!user && m.role !== "system" && m.text ? <SpeakButton messageId={m.id} /> : null}
                {m.attachments?.length ? <View style={{ flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" }}>{m.attachments.map((a: string) => <FileImage key={a} id={a} size={120} />)}</View> : null}
                {(m.cards || []).map((c: any, i: number) => <CardView key={i} c={c} role={role} onAnswer={(t) => send(t)} />)}
              </View>
            </View>
          );
        }}
      />
      {canWrite ? (
        <View style={{ borderTopWidth: 0.5, borderTopColor: colors.border, backgroundColor: colors.surface, paddingBottom: bottomPad + spacing.sm }}>
          {quickReplies.length ? <View style={{ paddingHorizontal: spacing.lg }}><ChipRow>{quickReplies.map((q, i) => <Chip key={q} testID={`quick-reply-${i}`} label={q} onPress={() => send(q)} />)}</ChipRow></View> : null}
          {atts.length ? <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}><PhotoStrip ids={atts} size={56} onRemove={(id) => setAtts(atts.filter((x) => x !== id))} /></View> : null}
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: quickReplies.length ? 0 : spacing.sm }}>
            <PhotoButtons compact testID="chat-photo" onUploaded={(id) => setAtts((a) => [...a, id])} />
            <MicButton disabled={busy} onText={onSpoken} />
            <TextInput testID="chat-input" value={text} onChangeText={setText} placeholder="Message" placeholderTextColor={colors.muted} multiline
              style={{ flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 22, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, backgroundColor: colors.surfaceTertiary, color: colors.onSurface, fontFamily: fonts.regular, fontSize: 16 }} />
            <Pressable testID="chat-send-button" accessibilityLabel="Send" onPress={() => send()} disabled={busy || (!text.trim() && !atts.length)}
              style={{ height: 44, width: 44, borderRadius: 22, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", opacity: busy || (!text.trim() && !atts.length) ? 0.5 : 1 }}>
              <Ionicons name="arrow-up" size={20} color={colors.onBrandPrimary} />
            </Pressable>
          </View>
        </View>
      ) : data ? (
        <View style={{ padding: spacing.lg, paddingBottom: bottomPad + spacing.lg, borderTopWidth: 0.5, borderTopColor: colors.border }}>
          <Txt v="small">{readOnlyNote || "Read-only. Rentwise handles this conversation for you."}</Txt>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

export { money };
