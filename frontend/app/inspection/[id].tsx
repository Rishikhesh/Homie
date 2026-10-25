import React, { useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { api } from "@/src/api";
import { useLive } from "@/src/useLive";
import { useAuth } from "@/src/auth";
import { uploadAsset } from "@/src/inputs";
import { BigButton, Card, ErrorState, Field, Ionicons, LargeHeader, Row, Screen, Section, Sheet, Skeleton, StatusPill, TextButton, Txt, useToast } from "@/src/ui";
import { Frame, Video } from "@/src/inspect";
import { radius, spacing, useTheme } from "@/src/theme";


const AREA_ICON = (l: string) => (/kitchen/i.test(l) ? "restaurant" : /bath/i.test(l) ? "water" : /bed|room/i.test(l) ? "bed" : /living/i.test(l) ? "tv" : /yard|garden|patio/i.test(l) ? "leaf" : /garage/i.test(l) ? "car" : "home");

type Up = "uploading" | "done" | "error";

export default function InspectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { me } = useAuth();
  const { data: i, error, reload } = useLive<any>(() => api(`/inspections/${id}`), 3000, [id]);
  if (error && !i) return <Screen><ErrorState message={error} onRetry={reload} /></Screen>;
  if (!i) return <Screen><Skeleton /></Screen>;
  const isTenant = me?.user?.id === i.tenant_id;
  const title = i.kind === "move_in" ? "Move-in check" : "Move-out check";
  if (isTenant && i.status === "in_progress") return <Capture i={i} reload={reload} title={title} />;
  if (i.status === "analyzing") return <Comparing i={i} title={title} />;
  if (isTenant && i.kind === "move_in" && i.status === "submitted") return <ReviewNotes i={i} reload={reload} />;
  return (
    <Screen testID="inspection-record-screen">
      <LargeHeader title={title} subtitle={`${i.tenant_name} · ${i.unit_label} · ${i.locked_at ? `locked ${i.locked_at.slice(0, 10)}` : ({ analyzed: "compared", submitted: "sent", confirmed: "locked" } as any)[i.status] || i.status.replace("_", " ")}`} back={() => router.back()} />
      {i.error ? <Card><Txt v="body">The comparison didn&apos;t finish. The tenant can submit again.</Txt></Card> : null}
      {i.statement_id && !isTenant ? <BigButton testID="open-statement-button" icon="document-text-outline" label="See move-out summary" onPress={() => router.push(`/statement/${i.statement_id}`)} style={{ marginBottom: spacing.lg }} /> : null}
      {i.areas.map((a: any) => (
        <Section key={a.key} title={a.label} testID={`record-area-${a.key}`}>
          <Card style={{ gap: spacing.sm }}>
            {a.video ? <Video fileId={a.video.file_id} testID={`record-video-${a.key}`} /> : a.frames?.length ? <Row>{a.frames.slice(0, 3).map((f: any) => <Frame key={f.file_id} id={f.file_id} />)}</Row> : <Txt v="small">Not recorded</Txt>}
            {a.ai_note ? <Txt v="body">✦ {a.ai_note}</Txt> : null}
            {a.tenant_note ? <Txt v="body">Tenant: {a.tenant_note}</Txt> : null}
          </Card>
        </Section>
      ))}
    </Screen>
  );
}

function Capture({ i, reload, title }: { i: any; reload: () => void; title: string }) {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const [idx, setIdx] = useState(0);
  const [up, setUp] = useState<Record<string, Up>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [explain, setExplain] = useState<null | "video" | "photo">(null);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const a = i.areas[idx];
  const last = idx === i.areas.length - 1;
  const ref = i.reference?.[a.key];
  const has = (x: any) => x.frames?.length || up[x.key] === "done";

  const send = async (asset: ImagePicker.ImagePickerAsset, key: string) => {
    setUp((u) => ({ ...u, [key]: "uploading" }));
    try {
      const isVid = asset.type === "video";
      if (isVid && asset.duration && asset.duration > 46000) throw new Error("Please keep the video under 45 seconds");
      const fid = await uploadAsset({ uri: asset.uri, name: asset.fileName || (isVid ? "area.mp4" : "area.jpg"), mimeType: asset.mimeType || (isVid ? "video/mp4" : "image/jpeg") });
      await api(`/inspections/${i.id}/areas/${key}/media`, { body: { file_id: fid } });
      setUp((u) => ({ ...u, [key]: "done" })); reload();
    } catch (e: any) { setUp((u) => ({ ...u, [key]: "error" })); toast(e.message, "error"); }
  };

  const capture = async (kind: "video" | "photo", fromLibrary = false) => {
    setExplain(null);
    if (!fromLibrary) {
      const cur = await ImagePicker.getCameraPermissionsAsync();
      const perm = cur.granted ? cur : cur.canAskAgain ? await ImagePicker.requestCameraPermissionsAsync() : cur;
      if (!perm.granted) { if (!perm.canAskAgain) setBlocked(true); else toast("Camera access is needed to record the room", "error"); return; }
    }
    const opts: ImagePicker.ImagePickerOptions = kind === "video"
      ? { mediaTypes: ["videos"], videoMaxDuration: 45, videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium }
      : { mediaTypes: ["images"], quality: 0.7 };
    const r = fromLibrary ? await ImagePicker.launchImageLibraryAsync({ ...opts, mediaTypes: ["videos", "images"] }) : await ImagePicker.launchCameraAsync(opts);
    if (r.canceled || !r.assets?.[0]) return;
    send(r.assets[0], a.key); // uploads in the background; the tenant can move on
  };

  const startCapture = async (kind: "video" | "photo") => {
    const cur = await ImagePicker.getCameraPermissionsAsync();
    if (cur.granted) capture(kind); else setExplain(kind);
  };

  const next = async () => {
    if (note[a.key] !== undefined) api(`/inspections/${i.id}/areas/${a.key}/note`, { method: "PUT", body: { note: note[a.key] } }).catch(() => {});
    if (!last) { setIdx(idx + 1); return; }
    if (Object.values(up).includes("uploading")) { toast("Still uploading — one moment", "error"); return; }
    setBusy(true);
    try { await api(`/inspections/${i.id}/submit`, { method: "POST" }); toast(i.kind === "move_in" ? "Sent — Homi is writing notes" : "Sent — Homi is comparing"); reload(); }
    catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  const st = up[a.key] || (a.frames?.length ? "done" : undefined);
  return (
    <Screen testID="inspection-capture-screen">
      <LargeHeader title={title} subtitle={`${a.label} · ${idx + 1} of ${i.areas.length}`} back={() => (idx ? setIdx(idx - 1) : router.back())} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.lg, flexGrow: 0 }} contentContainerStyle={{ gap: spacing.sm }}>
        {i.areas.map((x: any, j: number) => {
          const ok = has(x), cur = j === idx;
          return (
            <Pressable key={x.key} testID={`area-tile-${x.key}`} accessibilityLabel={`${x.label}${ok ? ", recorded" : ""}`} onPress={() => setIdx(j)}
              style={{ width: 84, minHeight: 84, borderRadius: radius.md, alignItems: "center", justifyContent: "center", gap: 4, padding: 6, borderWidth: 2,
                borderColor: cur ? colors.brandPrimary : ok ? colors.good : colors.border, backgroundColor: ok ? colors.goodSoft : colors.surfaceSecondary }}>
              <Ionicons name={(ok ? "checkmark-circle" : AREA_ICON(x.label)) as any} size={28} color={ok ? colors.good : colors.brandPrimary} />
              <Txt v="small" numberOfLines={1} style={{ color: colors.onSurface }}>{x.label}</Txt>
            </Pressable>
          );
        })}
      </ScrollView>
      {i.kind === "move_out" ? (
        ref ? (
          <Card style={{ gap: spacing.sm, marginBottom: spacing.lg }} testID="move-in-reference">
            <Frame id={ref} label="Move-in view" />
            <Txt v="body">Record the same view, same height, walk slowly.</Txt>
          </Card>
        ) : <Card style={{ marginBottom: spacing.lg }} testID="no-move-in-warning"><Row><Ionicons name="alert-circle" size={20} color={colors.onWarningSoft} /><Txt v="body" style={{ flex: 1 }}>No move-in record. The owner checks by hand.</Txt></Row></Card>
      ) : <Txt v="body" style={{ marginBottom: spacing.lg }}>Walk slowly. Show marks up close.</Txt>}
      <BigButton testID="record-video-button" icon="videocam" label={st === "done" ? "Record again" : "Record video (20–40 s)"} onPress={() => startCapture("video")} style={{ minHeight: 56 }} />
      <Row style={{ justifyContent: "space-between", marginVertical: spacing.sm }}>
        <TextButton testID="take-photos-button" icon="camera-outline" label="Take photos instead" onPress={() => startCapture("photo")} />
        <TextButton testID="pick-library-button" icon="images-outline" label="From library" onPress={() => capture("video", true)} />
      </Row>
      {st ? (
        <Row testID={`upload-state-${a.key}`} style={{ marginBottom: spacing.md }}>
          {st === "uploading" ? <ActivityIndicator color={colors.brand} /> : <Ionicons name={st === "done" ? "checkmark-circle" : "alert-circle"} size={20} color={st === "done" ? colors.success : colors.error} />}
          <Txt v="body">{st === "uploading" ? "Uploading… you can go on" : st === "done" ? `Saved${a.photos?.length ? ` · ${a.photos.length} photo(s)` : ""}` : "Upload failed — record again"}</Txt>
        </Row>
      ) : null}
      <Field testID="area-note-input" label="Anything to note? (optional)" placeholder="e.g. scratch on the door frame" value={note[a.key] ?? a.tenant_note ?? ""} onChangeText={(v) => setNote({ ...note, [a.key]: v })} />
      <BigButton testID="area-next-button" style={{ marginTop: spacing.xl }} label={last ? "Send check" : "Next"} loading={busy} disabled={last && !i.areas.some(has)} onPress={next} />
      <Sheet visible={!!explain} onClose={() => setExplain(null)} title="Use your camera" testID="camera-explain-sheet">
        <Txt v="body" style={{ marginBottom: spacing.lg }}>Homi records each room so there&apos;s clear proof of how it looked. This protects your deposit.</Txt>
        <BigButton testID="camera-explain-continue" label="Continue" onPress={() => capture(explain!)} />
      </Sheet>
      <Sheet visible={blocked} onClose={() => setBlocked(false)} title="Camera is off" testID="camera-blocked-sheet">
        <Txt v="body" style={{ marginBottom: spacing.lg }}>Turn on camera access in Settings to record the room, or pick a video from your library.</Txt>
        <BigButton testID="open-settings-button" label="Open Settings" onPress={() => { setBlocked(false); Linking.openSettings(); }} />
      </Sheet>
    </Screen>
  );
}

function ReviewNotes({ i, reload }: { i: any; reload: () => void }) {
  const toast = useToast();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const done = i.areas.filter((a: any) => a.frames?.length);
  const confirm = async () => {
    setBusy(true);
    try {
      for (const [k, v] of Object.entries(notes)) await api(`/inspections/${i.id}/areas/${k}/note`, { method: "PUT", body: { note: v } });
      await api(`/inspections/${i.id}/confirm`, { method: "POST" }); toast("Move-in record locked"); reload();
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  return (
    <Screen testID="inspection-review-screen">
      <LargeHeader title="Check the notes" subtitle={i.notes_ready ? "Fix anything that's wrong, then confirm" : "Homi is writing notes…"} />
      {!i.notes_ready ? <Card style={{ alignItems: "center", gap: spacing.sm, marginBottom: spacing.lg }}><ActivityIndicator /><Txt v="body">Looking at each area…</Txt></Card> : null}
      {done.map((a: any) => (
        <Card key={a.key} style={{ gap: spacing.sm, marginBottom: spacing.md }} testID={`review-area-${a.key}`}>
          <Row><Frame id={a.frames[0].file_id} /><View style={{ flex: 1.3, gap: 4 }}><Txt v="label">{a.label}</Txt><Txt v="body">{a.ai_note ? `✦ ${a.ai_note}` : i.notes_ready ? "No notes" : "…"}</Txt></View></Row>
          <Field testID={`review-note-${a.key}`} label="Your note" value={notes[a.key] ?? a.tenant_note ?? ""} onChangeText={(v) => setNotes({ ...notes, [a.key]: v })} />
        </Card>
      ))}
      <BigButton testID="looks-right-button" label="Looks right" loading={busy} onPress={confirm} style={{ minHeight: 56 }} />
      <Txt v="small" style={{ marginTop: spacing.sm }}>Once you confirm, this record is locked and can&apos;t be changed by anyone.</Txt>
    </Screen>
  );
}

function Comparing({ i, title }: { i: any; title: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <Screen testID="inspection-comparing-screen">
      <LargeHeader title={title} subtitle="Homi is comparing your home…" back={() => router.back()} />
      <Card style={{ gap: spacing.sm }}>
        {i.areas.map((a: any) => {
          const s = i.progress?.[a.key] || "waiting";
          return (
            <Row key={a.key} style={{ justifyContent: "space-between", minHeight: 44 }}>
              <Txt v="body">{a.label}</Txt>
              {s === "working" ? <ActivityIndicator color={colors.brand} /> : <StatusPill label={s === "done" ? "Done" : "Waiting"} tone={s === "done" ? "success" : "neutral"} />}
            </Row>
          );
        })}
      </Card>
    </Screen>
  );
}
