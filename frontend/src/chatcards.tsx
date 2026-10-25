// Visual cards in chat, drawn from live data (GET /cards/{type}/{ref}) so numbers are always right.
import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { api, authedUrl } from "@/src/api";
import { useLive } from "@/src/useLive";
import { Ionicons, Txt, useToast } from "@/src/ui";
import { BigNumber, Countdown, DocTile, More, PhotoPair, PersonChip, REPAIR_STEPS, Status, TimeChoice, Tracker, YesNo, burst, fmtSlot, tradeIcon } from "@/src/visual";
import { Role, slotLabel, statusOf } from "@/src/status";
import { radius, spacing, useTheme } from "@/src/theme";
import { PayButton } from "@/src/pay";

function Shell({ children, testID }: { children: React.ReactNode; testID?: string }) {
  const { colors } = useTheme();
  return <View testID={testID} style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border, gap: spacing.sm }}>{children}</View>;
}

const isDone = (s: string) => s === "closed";
export const repairCurrent = (t: any) => (isDone(t.status) ? 5 : t.status === "payment_pending_approval" ? 4 : t.step ?? 0);

export function RepairCard({ d, role, testID }: { d: any; role: Role; testID?: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  const st = statusOf(d, role);
  const next = d.picked_slot ? slotLabel(d.picked_slot) : d.handyman ? "Times coming soon" : "Finding someone";
  return (
    <Shell testID={testID}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Ionicons name={tradeIcon(d.trade) as any} size={22} color={colors.brandPrimary} />
        <Txt v="label" style={{ flex: 1, fontSize: 17 }} numberOfLines={1}>{d.title}</Txt>
      </View>
      <Tracker steps={REPAIR_STEPS} current={repairCurrent(d)} mine={st.kind === "you"} />
      <Status kind={st.kind} label={st.label} size="sm" />
      {d.handyman ? <PersonChip name={d.handyman.name} rating={d.handyman.rating} trade={d.handyman.trade} /> : null}
      {!isDone(d.status) ? <Txt v="small">{next}</Txt> : null}
      <Txt v="label" color={colors.brandPrimary} onPress={() => router.push(`/ticket/${d.ticket_id}`)} testID={testID ? `${testID}-open` : undefined}>Open repair ›</Txt>
    </Shell>
  );
}

function ChoiceCard({ d, role, reload }: { d: any; role: Role; reload: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const open = role === "tenant" && d.status === "awaiting_tenant_time";
  return (
    <Shell testID={`card-choice-${d.ticket_id}`}>
      <Txt v="label">Pick a time</Txt>
      {d.auto && d.quote ? <Txt v="small" testID="choice-auto-note">{role === "tenant" && !d.picked_slot ? `Price $${d.quote} · picking a time agrees to it` : `Price $${d.quote} · auto-OK'd, under the owner's limit`}</Txt> : null}
      <TimeChoice testIDPrefix="slot-chip" slots={d.slots} picked={d.picked_slot?.iso} disabled={!open || busy}
        onPick={open ? async (iso) => { setBusy(true); try { await api(`/tickets/${d.ticket_id}/pick-slot`, { body: { slot: iso } }); burst("Booked"); reload(); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); } } : undefined} />
      {d.picked_slot ? <Status kind="good" label={`Picked ${fmtSlot(d.picked_slot)}`} size="sm" /> : null}
    </Shell>
  );
}

function YesNoCard({ d, card, role, onAnswer, reload }: { d: any; card: any; role: Role; onAnswer?: (t: string) => void; reload: () => void }) {
  const toast = useToast();
  const [ans, setAns] = useState<"yes" | "no" | null>(null);
  const fixed = (card.question || d.question) === "fixed" && d.ticket_id;
  const q = fixed ? "Is it fixed?" : card.question || d.question;
  const closed = fixed && d.status !== "fixed_pending_confirm";
  const answer = async (ok: boolean) => {
    setAns(ok ? "yes" : "no");
    if (fixed) {
      try { await api(`/tickets/${d.ticket_id}/confirm`, { body: { ok } }); if (ok) burst("Fixed"); else toast("Asking them to come back"); reload(); } catch (e: any) { setAns(null); toast(e.message, "error"); }
    } else onAnswer?.(ok ? "Yes" : "No");
  };
  if (role !== "tenant" && fixed) return null;
  return (
    <Shell testID="card-yes-no">
      <Txt v="label">{q}</Txt>
      <YesNo testIDPrefix={fixed ? "confirm-fixed" : "yes-no"} yes={fixed ? "It works" : "Yes"} no={fixed ? "Not yet" : "No"} answered={ans || (closed ? "yes" : null)} disabled={closed} onYes={() => answer(true)} onNo={() => answer(false)} />
    </Shell>
  );
}

function RentCard({ d, role, reload }: { d: any; role: Role; reload: () => void }) {
  const st = statusOf(d.row, role, "rent");
  return (
    <Shell testID="card-rent">
      <BigNumber value={d.amount} caption={`${d.label} · rent`} small />
      <Status kind={st.kind} label={st.label} size="sm" />
      {role === "tenant" && d.row ? <PayButton due={d.row} deposit={null} onPaid={reload} landlord="your landlord" /> : null}
    </Shell>
  );
}

function MoneyCardChat({ d, role }: { d: any; role: Role }) {
  const router = useRouter();
  const pending = d.status === "pending";
  const kind = pending ? (d.for_landlord ? "you" : "waiting") : "good";
  const label = pending ? (d.for_landlord ? "Needs your OK" : "Waiting for owner") : d.kind === "refund" ? "Deposit back" : d.kind === "credit" ? "Off next rent" : "Done";
  return (
    <Shell testID="card-money">
      <BigNumber value={d.amount} sign={d.kind === "charge" ? "out" : role === "tenant" ? "in" : undefined} small />
      <Txt v="label">{d.what}</Txt>
      <Status kind={kind} label={label} size="sm" />
      {d.statement_id ? <Txt v="label" color={undefined} onPress={() => router.push(`/statement/${d.statement_id}`)}>Open move-out summary ›</Txt> : null}
    </Shell>
  );
}

function DocCard({ d }: { d: any }) {
  const router = useRouter();
  return <DocTile testID="card-doc" name={d.name} icon={d.icon} onView={() => (d.route ? router.push(d.route) : WebBrowser.openBrowserAsync(authedUrl(d.pdf)))} shareUrl={d.pdf ? authedUrl(d.pdf) : undefined} />;
}

function LawCard({ d }: { d: any }) {
  const { colors } = useTheme();
  return (
    <Shell testID="card-law">
      <Status kind="none" label={`${d.name} rules`} size="sm" />
      {d.answer ? <Txt v="body">{d.answer}</Txt> : null}
      <More testID="card-law-more">
        {Object.entries(d.rules || {}).map(([k, v]) => <Txt key={k} v="small">{k.replace(/_/g, " ")}: {String(v)}</Txt>)}
        <Txt v="small">General info, not legal advice.</Txt>
      </More>
      {d.source_url ? <Txt v="label" color={colors.brandPrimary} onPress={() => WebBrowser.openBrowserAsync(d.source_url)}>Source ›</Txt> : null}
    </Shell>
  );
}

/** One chat card of the new typed kinds; also accepts the legacy shapes still stored on older messages. */
export function LiveCard({ c, role, onAnswer }: { c: any; role: Role; onAnswer?: (t: string) => void }) {
  const type = ({ ticket: "repair", slots: "choice_time", confirm_fix: "yes_no" } as any)[c.type] || c.type;
  const ref = c.ref_id || c.ticket_id || "-";
  const question = c.type === "confirm_fix" ? "fixed" : c.question;
  const noFetch = type === "yes_no" && ref === "-";
  const { data: d, reload } = useLive<any>(() => (noFetch ? Promise.resolve({ question }) : api(`/cards/${type}/${ref}${question ? `?q=${encodeURIComponent(question)}` : ""}`)), ["repair", "choice_time", "yes_no"].includes(type) ? 5000 : 0, [type, ref]);
  if (!d) return null;
  switch (type) {
    case "repair": return <RepairCard d={d} role={role} testID={`chat-ticket-card-${d.ticket_id}`} />;
    case "choice_time": return <ChoiceCard d={d} role={role} reload={reload} />;
    case "yes_no": return <YesNoCard d={d} card={{ ...c, question }} role={role} onAnswer={onAnswer} reload={reload} />;
    case "rent": return <RentCard d={d} role={role} reload={reload} />;
    case "money": return <MoneyCardChat d={d} role={role} />;
    case "doc": return <DocCard d={d} />;
    case "countdown": return <Shell testID="card-countdown"><Countdown days={d.days} caption={d.caption} /></Shell>;
    case "photo_pair": return <Shell testID="card-photo-pair"><Txt v="label">{d.title}</Txt><PhotoPair before={d.before} after={d.after} box={d.box} /></Shell>;
    case "law": return <LawCard d={d} />;
    default: return null;
  }
}
export const LIVE_TYPES = ["repair", "rent", "money", "choice_time", "yes_no", "doc", "countdown", "photo_pair", "law", "ticket", "slots", "confirm_fix"];
