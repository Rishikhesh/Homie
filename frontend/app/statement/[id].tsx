import React, { useState } from "react";
import { Modal, Pressable, RefreshControl, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, money } from "@/src/api";
import { useLive } from "@/src/useLive";
import { useAuth } from "@/src/auth";
import { openPdf } from "@/src/cards";
import { PhotoButtons } from "@/src/inputs";
import { BigButton, Card, Chip, ChipRow, ConfirmSheet, ErrorState, Field, LargeHeader, Row, Screen, Section, Sheet, Skeleton, StatusPill, TextButton, Txt, useToast } from "@/src/ui";
import { CAT_LABEL, Frame, mmss, Video } from "@/src/inspect";
import { BigNumber, Countdown as Ring, MOVE_OUT_STEPS, Status, StripCard, Tracker } from "@/src/visual";
import { Kind, when } from "@/src/status";

const CAT_KIND: Record<string, Kind> = { damage: "you", check: "waiting", pre_existing: "none", normal_wear: "none", reported_repair: "none" };
import { spacing, useTheme } from "@/src/theme";

export default function StatementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { me } = useAuth();
  const { colors } = useTheme();
  const { data: live, error, reload } = useLive<any>(() => api(`/statements/${id}`), 0, [id]);
  const [local, setLocal] = useState<any>(null);
  const [showFree, setShowFree] = useState(false);
  const [add, setAdd] = useState<any>(null);
  const [cat, setCat] = useState<any>(null);
  const [full, setFull] = useState<any>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const s = local && live && local.version >= live.version ? local : live;
  if (error && !s) return <Screen><ErrorState message={error} onRetry={reload} /></Screen>;
  if (!s) return <Screen><Skeleton /></Screen>;
  const isLandlord = me?.user?.id === s.landlord_id || me?.real_user?.id === s.landlord_id;
  const canEdit = isLandlord && s.status === "draft" && !me?.acting;
  const first = s.tenant_name.split(" ")[0];
  const edit = async (body: any) => {
    try { setLocal(await api(`/statements/${id}`, { method: "PATCH", body: { version: s.version, ...body } })); }
    catch (e: any) { toast(e.message, "error"); if (e.status === 409) { setLocal(null); reload(); } }
  };
  const items = s.items || [];
  const charges = items.filter((x: any) => x.category === "damage");
  const checks = items.filter((x: any) => x.category === "check");
  const free = items.filter((x: any) => !["damage", "check"].includes(x.category));
  const day = (x?: string | null) => { if (!x) return "—"; const d = new Date(`${String(x).slice(0, 10)}T12:00:00`); return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
  const label = (side: "in" | "out", fid: string) => `${side === "in" ? `Move-in · ${day(s.move_in_date)}` : `Move-out · ${day(s.move_out_date)}`}${s.frame_times?.[fid] != null ? ` · ${mmss(s.frame_times[fid])}` : ""}`;

  const Item = ({ it }: { it: any }) => {
    const [price, setPrice] = useState(String(it.charge));
    return (
      <StripCard kind={it.removed ? "none" : CAT_KIND[it.category] || "none"} testID={`statement-item-${it.id}`} style={{ gap: spacing.sm, opacity: it.removed ? 0.5 : 1 }}>
        <Row style={{ justifyContent: "space-between" }}>
          <Txt v="label" style={{ flex: 1, textDecorationLine: it.removed ? "line-through" : "none" }}>{s.areas?.[it.area_key] || it.area_key} · {it.title}</Txt>
          {it.category === "damage" ? <Txt v="label" style={{ fontSize: 16 }}>{money(it.charge)}</Txt> : null}
        </Row>
        {it.move_in_frame_id || it.move_out_frame_id ? (
          <Row style={{ alignItems: "flex-start" }}>
            <Frame testID={`frame-in-${it.id}`} id={it.move_in_frame_id} label={label("in", it.move_in_frame_id)} onPress={it.move_in_frame_id ? () => setFull({ fid: it.move_in_frame_id, side: "in", area: it.area_key }) : undefined} />
            <Frame testID={`frame-out-${it.id}`} id={it.move_out_frame_id} box={it.box} label={label("out", it.move_out_frame_id)} onPress={it.move_out_frame_id ? () => setFull({ fid: it.move_out_frame_id, side: "out", area: it.area_key, box: it.box }) : undefined} />
          </Row>
        ) : null}
        <Status size="sm" kind={it.removed ? "none" : CAT_KIND[it.category] || "none"} label={CAT_LABEL[it.category]} />
        <Row>{it.severity ? <StatusPill label={`Severity ${it.severity}/5`} tone={it.severity >= 4 ? "error" : "warning"} /> : null}{it.source === "landlord" ? <StatusPill label="Added by you" tone="neutral" /> : null}{it.disputed ? <StatusPill label="Dropped after question" tone="success" /> : null}</Row>
        <Txt v="body">{it.explanation}</Txt>
        {canEdit ? (
          <View style={{ gap: spacing.sm }}>
            {it.category === "damage" && !it.removed ? (
              <Row>
                <View style={{ flex: 1 }}><Field testID={`item-price-${it.id}`} label="Price ($)" keyboardType="number-pad" value={price} onChangeText={setPrice} hint={it.estimate_high ? `Estimate ${money(it.estimate_low)}–${money(it.estimate_high)}` : undefined} /></View>
                <TextButton testID={`item-price-save-${it.id}`} label="Save" disabled={price === String(it.charge)} onPress={() => edit({ op: "price", item_id: it.id, charge: Number(price) })} />
              </Row>
            ) : null}
            <Row style={{ justifyContent: "space-between" }}>
              <TextButton testID={`item-category-${it.id}`} label="Change type" onPress={() => setCat(it)} />
              {it.removed ? <TextButton testID={`item-undo-${it.id}`} label="Undo" onPress={() => edit({ op: "undo", item_id: it.id })} />
                : <TextButton testID={`item-remove-${it.id}`} label="Remove" color={colors.error} onPress={() => edit({ op: "remove", item_id: it.id })} />}
            </Row>
          </View>
        ) : !isLandlord && it.category === "damage" && !it.removed ? (
        <TextButton testID={`question-item-${it.id}`} icon="chatbubble-ellipses-outline" label="Question this" onPress={() => router.push({ pathname: "/(tenant)/chat", params: { q: `I'd like to question the move-out charge "${it.title}" (${money(it.charge)}).` } } as any)} />
        ) : null}
      </StripCard>
    );
  };

  return (
    <Screen testID="statement-screen" refresh={<RefreshControl refreshing={false} onRefresh={() => { setLocal(null); reload(); }} />}>
      <LargeHeader title="Move-out summary" subtitle={`${s.tenant_name.split(" ")[0]} · ${s.unit_label}`} back={() => router.back()} />
      <Card agent testID="statement-totals" style={{ gap: spacing.sm, marginBottom: spacing.xl }}>
        <Tracker steps={MOVE_OUT_STEPS} current={s.status === "draft" ? 3 : 5} mine={s.status === "draft" && isLandlord} />
        <BigNumber testID="statement-refund" value={s.refund} sign="in" caption={`Deposit back to ${first}`} />
        <Status size="sm" kind={s.total_deductions ? "none" : "good"} label={`${money(s.total_deductions)} kept from ${money(s.deposit)}`} />
        {s.status === "draft" ? <Ring days={s.days_left} total={30} caption={`Refund due ${when(s.due_by)}`} /> : null}
        {s.over_deposit ? <Txt v="label" color={colors.error}>Damage is {money(s.over_deposit)} more than the deposit. Rentwise doesn&apos;t collect this; talk to {first}.</Txt> : null}
        {isLandlord ? <Txt v="small">Checked {s.stats?.pairs_screened || 0} views · {s.stats?.sent_to_sonnet || 0} looked at closely</Txt> : null}
      </Card>
      <Section title={`Charges · ${charges.length}`} testID="charges-section" right={canEdit ? <TextButton testID="add-charge-button" label="+ Add a charge" onPress={() => setAdd({ area_key: Object.keys(s.areas || {})[0] || "other" })} /> : undefined}>
        {charges.length ? charges.map((it: any) => <Item key={it.id} it={it} />) : <Card><Txt v="body">No charges.</Txt></Card>}
      </Section>
      {checks.length ? <Section title={`Check these · ${checks.length}`} testID="check-section">{checks.map((it: any) => <Item key={it.id} it={it} />)}</Section> : null}
      {free.length ? (
        <Section title={`Not charged · ${free.length}`} testID="free-section" right={<TextButton testID="toggle-free" label={showFree ? "Hide" : "Show"} onPress={() => setShowFree(!showFree)} />}>
          {showFree ? free.map((it: any) => <Item key={it.id} it={it} />) : null}
        </Section>
      ) : null}
      {canEdit ? <BigButton testID="approve-statement-button" label={`OK and send to ${first}`} style={{ minHeight: 56 }} onPress={() => setConfirm(true)} /> : null}
      {s.status === "sent" ? <TextButton testID="statement-pdf-button" icon="document-text-outline" label="Statement (PDF)" onPress={() => openPdf(`/statements/${id}/pdf`)} /> : null}

      <ConfirmSheet visible={confirm} onClose={() => setConfirm(false)} title={`Send to ${first} and refund?`} amount={s.refund} body="Simulated. No real money moves." confirmLabel="OK and send" loading={busy} testID="approve-statement-confirm"
        onConfirm={async () => {
          setBusy(true);
          try {
            const h = await api("/landlord/home");
            const a = h.approvals.find((x: any) => x.kind === "deposit_statement" && x.statement_id === id);
            if (!a) throw new Error("This statement was already approved");
            await api(`/approvals/${a.id}/decide`, { body: { action: "approve" } });
            toast("Statement sent"); setConfirm(false); setLocal(null); reload();
          } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
        }} />
      <Sheet visible={!!cat} onClose={() => setCat(null)} title="What is this?" testID="category-sheet">
        {cat?.category === "normal_wear" ? <Txt v="label" color={colors.onWarningSoft} style={{ marginBottom: spacing.sm }}>Most states don&apos;t allow charging for normal wear.</Txt> : null}
        <View style={{ gap: spacing.sm }}>
          {Object.entries(CAT_LABEL).map(([k, v]) => <BigButton key={k} testID={`category-${k}`} tone={cat?.category === k ? "brand" : "soft"} label={v} onPress={() => { edit({ op: "category", item_id: cat.id, category: k }); setCat(null); }} />)}
        </View>
      </Sheet>
      <Sheet visible={!!add} onClose={() => setAdd(null)} title="Add a charge" testID="add-charge-sheet">
        {add ? (
          <View style={{ gap: spacing.md }}>
            <ChipRow>{Object.entries(s.areas || {}).map(([k, v]: any) => <Chip key={k} testID={`add-area-${k}`} label={v} selected={add.area_key === k} onPress={() => setAdd({ ...add, area_key: k })} />)}</ChipRow>
            <Field testID="add-title-input" label="What is it?" value={add.title || ""} onChangeText={(v) => setAdd({ ...add, title: v })} />
            <Field testID="add-explanation-input" label="Explanation" value={add.explanation || ""} onChangeText={(v) => setAdd({ ...add, explanation: v })} />
            <Field testID="add-price-input" label="Price ($)" keyboardType="number-pad" value={add.charge || ""} onChangeText={(v) => setAdd({ ...add, charge: v })} />
            <PhotoButtons testID="add-photo" compact label="Add a photo (optional)" onUploaded={(pid) => setAdd({ ...add, photo_id: pid })} />
            <BigButton testID="add-charge-save" label="Add charge" disabled={!add.title || add.charge === undefined || add.charge === ""} onPress={() => { edit({ op: "add", item: { ...add, charge: Number(add.charge) } }); setAdd(null); }} />
          </View>
        ) : null}
      </Sheet>
      <Modal visible={!!full} transparent animationType="fade" onRequestClose={() => setFull(null)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.92)", justifyContent: "center", padding: spacing.lg, gap: spacing.lg }} onPress={() => setFull(null)} testID="frame-fullscreen">
          {full?.play && s.videos?.[`${full.side}:${full.area}`] ? <Video fileId={s.videos[`${full.side}:${full.area}`]} start={s.frame_times?.[full.fid] || 0} testID="frame-video" /> : <Frame id={full?.fid} box={full?.box} size={600} />}
          {full && !full.play && s.videos?.[`${full.side}:${full.area}`] ? <BigButton testID="play-from-here" icon="play" label={`Play from ${mmss(s.frame_times?.[full.fid] || 0)}`} onPress={() => setFull({ ...full, play: true })} /> : null}
          <Txt v="body" color="#FFFFFF" style={{ textAlign: "center" }}>Tap anywhere to close</Txt>
        </Pressable>
      </Modal>
    </Screen>
  );
}
