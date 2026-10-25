import React, { useState } from "react";
import { Linking, Platform, Pressable, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { api, ApiError, session, API } from "@/src/api";
import { uploadForm } from "@/src/utils/upload";
import { BigButton, Chip, ChipRow, Ionicons, Sheet, TextButton, Txt, useToast, FileImage } from "@/src/ui";
import { radius, spacing, useTheme } from "@/src/theme";

export async function uploadAsset(asset: { uri: string; fileName?: string | null; name?: string; mimeType?: string | null }): Promise<string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${session.token}` };
  if (session.actAs) headers["X-Act-As"] = session.actAs;
  const res: any = await uploadForm(`${API}/upload`, { headers, files: { file: { uri: asset.uri, name: asset.name ?? asset.fileName ?? "photo.jpg", mimeType: asset.mimeType ?? "image/jpeg" } } });
  const data = typeof res?.json === "function" ? await res.json() : res;
  if (res?.ok === false || !data?.id) throw new ApiError(res?.status || 500, data?.detail || "Upload didn't go through. Tap to try again");
  return data.id;
}

/** Camera + library buttons with the full permission contract. Calls onUploaded(fileId). */
export function PhotoButtons({ onUploaded, testID = "photo", compact, label }: { onUploaded: (id: string) => void; testID?: string; compact?: boolean; label?: string }) {
  const toast = useToast();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [explain, setExplain] = useState<null | "camera" | "library">(null);
  const [blocked, setBlocked] = useState<null | string>(null);

  const run = async (src: "camera" | "library") => {
    setExplain(null);
    const perm = src === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) setBlocked(src);
      else toast(src === "camera" ? "Camera access is needed to take a photo" : "Photo access is needed to pick a photo", "error");
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.6 };
    const r = src === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled || !r.assets?.[0]) return;
    setBusy(true);
    try { onUploaded(await uploadAsset(r.assets[0])); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  const start = async (src: "camera" | "library") => {
    if (Platform.OS === "web") return run(src === "camera" ? "library" : src);
    const cur = src === "camera" ? await ImagePicker.getCameraPermissionsAsync() : await ImagePicker.getMediaLibraryPermissionsAsync();
    if (cur.granted) return run(src);
    if (!cur.canAskAgain && cur.status === "denied") return setBlocked(src);
    setExplain(src);
  };
  return (
    <>
      <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
        {label ? <Txt v="label" style={{ marginRight: 4 }}>{label}</Txt> : null}
        <Pressable testID={`${testID}-camera-button`} onPress={() => start("camera")} disabled={busy} style={{ flexDirection: "row", gap: 4, alignItems: "center", minHeight: 44, paddingHorizontal: compact ? 8 : 12, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary }}>
          <Ionicons name="camera-outline" size={18} color={colors.onSurface} />{compact ? null : <Txt v="label" style={{ fontSize: 14 }}>Camera</Txt>}
        </Pressable>
        <Pressable testID={`${testID}-library-button`} onPress={() => start("library")} disabled={busy} style={{ flexDirection: "row", gap: 4, alignItems: "center", minHeight: 44, paddingHorizontal: compact ? 8 : 12, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary }}>
          <Ionicons name="images-outline" size={18} color={colors.onSurface} />{compact ? null : <Txt v="label" style={{ fontSize: 14 }}>Photos</Txt>}
        </Pressable>
        {busy ? <Txt v="small">Uploading…</Txt> : null}
      </View>
      <Sheet visible={!!explain} onClose={() => setExplain(null)} title={explain === "camera" ? "Take a photo" : "Pick a photo"} testID={`${testID}-permission-sheet`}>
        <Txt v="body" style={{ marginBottom: spacing.lg }}>A photo helps Homi tell the handyman what to bring, so the fix happens in one visit.</Txt>
        <BigButton testID={`${testID}-permission-continue`} label="Continue" onPress={() => run(explain!)} />
      </Sheet>
      <Sheet visible={!!blocked} onClose={() => setBlocked(null)} title="Access is turned off" testID={`${testID}-blocked-sheet`}>
        <Txt v="body" style={{ marginBottom: spacing.lg }}>Turn on {blocked === "camera" ? "Camera" : "Photos"} for Homi in Settings to add photos. You can still describe the problem in words.</Txt>
        <BigButton testID={`${testID}-open-settings`} label="Open Settings" onPress={() => { setBlocked(null); Linking.openSettings(); }} />
        <TextButton testID={`${testID}-blocked-close`} label="Not now" onPress={() => setBlocked(null)} />
      </Sheet>
    </>
  );
}

export function PhotoStrip({ ids, onRemove, size = 72 }: { ids: string[]; onRemove?: (id: string) => void; size?: number }) {
  if (!ids.length) return null;
  return (
    <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
      {ids.map((id) => (
        <Pressable key={id} onPress={() => onRemove?.(id)} testID={`photo-thumb-${id}`}><FileImage id={id} size={size} /></Pressable>
      ))}
    </View>
  );
}

// ---------- date/time ----------
function nextDays(n: number) {
  const out: Date[] = [];
  for (let i = 0; i < n; i++) { const d = new Date(); d.setDate(d.getDate() + i + 1); d.setHours(0, 0, 0, 0); out.push(d); }
  return out;
}
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
export function fmtDate(d: Date) {
  return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: d.getMinutes() ? "2-digit" : undefined });
}

/** Native picker on phones (Android: date then time dialogs; iOS: compact native picker). Web preview: day + hour chips. */
export function DateTimeField({ value, onChange, mode = "datetime", testID, label }: { value: Date | null; onChange: (d: Date) => void; mode?: "datetime" | "date"; testID: string; label: string }) {
  const { colors } = useTheme();
  const [day, setDay] = useState<number | null>(() => {
    if (!value) return null;
    const i = nextDays(7).findIndex((d) => d.toDateString() === value.toDateString());
    return i >= 0 ? i : null;
  });
  if (Platform.OS === "ios") {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 50 }}>
        <Txt v="label">{label}</Txt>
        <DateTimePicker testID={testID} value={value || new Date(Date.now() + 86400000)} mode={mode} minimumDate={mode === "datetime" ? new Date() : undefined} minuteInterval={15} onChange={(_, d) => d && onChange(d)} />
      </View>
    );
  }
  if (Platform.OS === "android") {
    const open = () => {
      const base = value || new Date(Date.now() + 86400000);
      DateTimePickerAndroid.open({ value: base, mode: "date", minimumDate: mode === "datetime" ? new Date() : undefined, onChange: (e, d) => {
        if (e.type !== "set" || !d) return;
        if (mode === "date") return onChange(d);
        DateTimePickerAndroid.open({ value: d, mode: "time", is24Hour: false, onChange: (e2, t) => { if (e2.type === "set" && t) onChange(t); } });
      } });
    };
    return (
      <Pressable testID={testID} onPress={open} style={{ minHeight: 50, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, paddingHorizontal: 14, justifyContent: "center" }}>
        <Txt v="small">{label}</Txt>
        <Txt v="label">{value ? (mode === "date" ? value.toDateString() : fmtDate(value)) : "Tap to choose"}</Txt>
      </Pressable>
    );
  }
  // web fallback
  if (mode === "date") {
    const months = Array.from({ length: 14 }).map((_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + i - 1); return d; });
    return (
      <View style={{ gap: 6 }}>
        <Txt v="label">{label}</Txt>
        <ChipRow>{months.map((d, i) => <Chip key={i} testID={`${testID}-month-${i}`} label={d.toLocaleDateString("en-US", { month: "short", year: "numeric" })} selected={!!value && value.getMonth() === d.getMonth() && value.getFullYear() === d.getFullYear()} onPress={() => onChange(d)} />)}</ChipRow>
      </View>
    );
  }
  const days = nextDays(7);
  return (
    <View style={{ gap: 6 }}>
      <Txt v="label">{label}{value ? ` · ${fmtDate(value)}` : ""}</Txt>
      <ChipRow>{days.map((d, i) => <Chip key={i} testID={`${testID}-day-${i}`} label={d.toLocaleDateString("en-US", { weekday: "short" }) + " " + d.getDate()} selected={day === i} onPress={() => setDay(i)} />)}</ChipRow>
      {day != null ? (
        <ChipRow>{HOURS.map((h) => <Chip key={h} testID={`${testID}-hour-${h}`} label={`${h % 12 || 12} ${h < 12 ? "am" : "pm"}`} selected={!!value && value.getHours() === h && value.getDate() === days[day].getDate()} onPress={() => { const d = new Date(days[day]); d.setHours(h); onChange(d); }} />)}</ChipRow>
      ) : null}
    </View>
  );
}

export { api };
