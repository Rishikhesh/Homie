// "See it, don't read it": the visual building blocks used everywhere instead of paragraphs.
import React, { useEffect, useState } from "react";
import { Modal, Pressable, Share, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeOut, LinearTransition, ZoomIn, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { Avatar, Card, FileImage, Ionicons, Txt } from "@/src/ui";
import { KIND_ICON, KIND_SPOKEN, Kind, kindColor, kindSoft } from "@/src/status";
import { money } from "@/src/api";
import { fonts, radius, spacing, useTheme } from "@/src/theme";

export const TRADE_ICON: Record<string, string> = { plumbing: "water", electrical: "flash", hvac: "thermometer", appliance: "cube", locksmith: "key", pest: "bug",
  roofing: "home", carpentry: "hammer", painting: "color-palette", general: "construct", other: "construct" };
export const tradeIcon = (t?: string) => TRADE_ICON[(t || "general").toLowerCase()] || "construct";
export const tradeName = (t?: string) => (t ? t[0].toUpperCase() + t.slice(1) : "Repair");

// ---------- Status ----------
export function Status({ kind, label, size = "md", testID }: { kind: Kind; label: string; size?: "sm" | "md"; testID?: string }) {
  const { colors } = useTheme();
  const c = kindColor(colors, kind);
  const sm = size === "sm";
  return (
    <View testID={testID} accessible accessibilityLabel={`${label}, ${KIND_SPOKEN[kind]}`} style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", flexShrink: 1 }}>
      <Ionicons name={KIND_ICON[kind] as any} size={sm ? 16 : 20} color={c} />
      <Txt weight="semibold" style={{ fontSize: sm ? 14 : 15, flexShrink: 1 }} color={kind === "none" ? colors.onSurfaceTertiary : c}>{label}</Txt>
    </View>
  );
}

/** A card with a 4 px status strip on the left, so a list reads at a glance. */
export function StripCard({ kind, children, onPress, testID, index = 0, style }: { kind: Kind; children: React.ReactNode; onPress?: () => void; testID?: string; index?: number; style?: any }) {
  const { colors } = useTheme();
  void kind; void colors;
  return <Card index={index} testID={testID} onPress={onPress} style={style}>{children}</Card>;
}

// ---------- BigNumber ----------
export function BigNumber({ value, caption, sign, testID, color, small }: { value: number | string; caption?: string; sign?: "in" | "out" | "held"; testID?: string; color?: string; small?: boolean }) {
  const { colors } = useTheme();
  const txt = typeof value === "number" ? money(value) : value;
  const c = color || (sign === "in" ? colors.good : sign === "out" ? colors.you : sign === "held" ? colors.none : colors.onSurface);
  return (
    <View style={{ gap: 2, flexShrink: 1 }}>
      <Txt testID={testID} weight="extrabold" color={c} numberOfLines={1} style={{ fontSize: small ? 22 : 28, lineHeight: small ? 30 : 36, letterSpacing: -0.5, paddingTop: 2 }}>{sign === "in" ? "+" : sign === "out" ? "−" : ""}{txt}</Txt>
      {caption ? <Txt v="caption" numberOfLines={2}>{caption}</Txt> : null}
    </View>
  );
}

// ---------- Tracker ----------
export type Step = { icon: string; label: string };
export const REPAIR_STEPS: Step[] = [{ icon: "construct", label: "Reported" }, { icon: "person", label: "Handyman" }, { icon: "calendar", label: "Booked" }, { icon: "checkmark-done", label: "Fixed" }, { icon: "cash", label: "Paid" }];
export const MOVE_OUT_STEPS: Step[] = [{ icon: "videocam", label: "Move-in" }, { icon: "cube", label: "Move-out" }, { icon: "search", label: "Compared" }, { icon: "thumbs-up", label: "OK'd" }, { icon: "cash", label: "Refund" }];
export const MOVE_IN_STEPS: Step[] = [{ icon: "document-text", label: "Lease" }, { icon: "shield-checkmark", label: "Insurance" }, { icon: "flash", label: "Utilities" }, { icon: "home", label: "Moved in" }];
export const SIGN_STEPS: Step[] = [{ icon: "reader", label: "Read" }, { icon: "create", label: "Sign" }, { icon: "checkmark-done", label: "Done" }];

function Pulse({ children, on }: { children: React.ReactNode; on: boolean }) {
  const reduce = useReducedMotion();
  const s = useSharedValue(1);
  useEffect(() => { if (on && !reduce) s.value = withRepeat(withTiming(1.12, { duration: 700 }), -1, true); else s.value = 1; }, [on, reduce, s]);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return <Animated.View style={st}>{children}</Animated.View>;
}

/** current = index of the step in progress; current >= steps.length means all done. mine = it's waiting on the viewer (red). */
export function Tracker({ steps = REPAIR_STEPS, current, mine, compact, testID }: { steps?: Step[]; current: number; mine?: boolean; compact?: boolean; testID?: string }) {
  const { colors } = useTheme();
  const d = compact ? 22 : 30;
  const now = steps[Math.min(current, steps.length - 1)];
  return (
    <View testID={testID} accessible accessibilityLabel={current >= steps.length ? "All steps done" : `Step ${current + 1} of ${steps.length}: ${now.label}${mine ? ", needs you" : ""}`}
      style={{ flexDirection: "row", alignItems: "flex-start", marginTop: compact ? 4 : spacing.sm }}>
      {!compact ? <View pointerEvents="none" style={{ position: "absolute", left: `${50 / steps.length}%`, right: `${50 / steps.length}%`, top: d / 2 - 1, height: 2, backgroundColor: colors.border }} /> : null}
      {steps.map((s, i) => {
        const done = i < current, cur = i === current;
        const c = done ? colors.good : cur ? (mine ? colors.you : colors.waiting) : colors.none;
        return (
          <React.Fragment key={s.label}>
            {i && compact ? <View style={{ flex: 1, height: 2, borderRadius: 1, marginTop: d / 2 - 1, backgroundColor: i <= current ? colors.good : colors.border, minWidth: 4 }} /> : null}
            <View style={compact ? { alignItems: "center", width: d } : { alignItems: "center", flex: 1, minWidth: 0, gap: 4 }}>
              <Pulse on={cur}>
                <View style={{ width: d, height: d, borderRadius: d / 2, alignItems: "center", justifyContent: "center", backgroundColor: done ? colors.good : cur ? kindSoft(colors, mine ? "you" : "waiting") : "transparent", borderWidth: done ? 0 : 2, borderColor: c }}>
                  <Ionicons name={(done ? "checkmark" : s.icon) as any} size={compact ? 11 : 15} color={done ? colors.onBrandPrimary : c} />
                </View>
              </Pulse>
              {!compact ? <Txt numberOfLines={1} style={{ fontSize: 11 }} weight={cur ? "bold" : "medium"} color={cur ? c : colors.muted}>{s.label}</Txt> : null}
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

// ---------- PersonChip ----------
export function PersonChip({ name, uri, rating, trade, testID }: { name: string; uri?: string | null; rating?: number | null; trade?: string; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, alignSelf: "flex-start", paddingRight: spacing.md, paddingVertical: 4, paddingLeft: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary }}>
      <Avatar name={name} uri={uri} size={28} />
      <Txt weight="semibold" numberOfLines={1} style={{ fontSize: 14, flexShrink: 0 }}>{name.split(" ")[0]}</Txt>
      {rating ? <Txt weight="semibold" numberOfLines={1} style={{ fontSize: 15, flexShrink: 0 }} color={colors.waiting}>★ {rating.toFixed(1)}</Txt> : null}
      {trade ? <Row2><Ionicons name={tradeIcon(trade) as any} size={16} color={colors.brandPrimary} /><Txt numberOfLines={1} style={{ fontSize: 15, flexShrink: 1 }}>{tradeName(trade)}</Txt></Row2> : null}
    </View>
  );
}
const Row2 = ({ children }: { children: React.ReactNode }) => <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 }}>{children}</View>;

// ---------- TimeChoice / YesNo ----------
export function TimeChoice({ slots, picked, onPick, disabled, testIDPrefix = "time-choice" }: { slots: { iso: string; label: string }[]; picked?: string | null; onPick?: (iso: string, label: string) => void; disabled?: boolean; testIDPrefix?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      {slots.map((s, i) => {
        const on = picked === s.iso;
        return (
          <Pressable key={s.iso} testID={`${testIDPrefix}-${i}`} accessibilityRole="button" accessibilityState={{ selected: on, disabled: disabled || !onPick }} disabled={disabled || !onPick} onPress={() => onPick?.(s.iso, s.label)}
            style={({ pressed }) => ({ minHeight: 48, borderRadius: radius.md, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, borderWidth: 2,
              borderColor: on ? colors.good : colors.border, backgroundColor: on ? colors.goodSoft : colors.surfaceSecondary, opacity: (disabled || !onPick) && !on ? 0.55 : pressed ? 0.8 : 1 })}>
            <Ionicons name={on ? "checkmark-circle" : "calendar-outline"} size={20} color={on ? colors.good : colors.brandPrimary} />
            <Txt weight="semibold" style={{ fontSize: 15, flex: 1 }}>{fmtSlot(s)}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
/** "Thu · 3 pm" from a slot. */
export function fmtSlot(s: { iso?: string; label?: string }) {
  if (s.label) return s.label; // server label is in the property's time zone
  if (!s.iso) return "";
  const d = new Date(s.iso);
  if (isNaN(d.getTime())) return s.label || "";
  const h = d.getHours(), m = d.getMinutes();
  return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

export function YesNo({ onYes, onNo, yes = "Yes", no = "No", disabled, answered, testIDPrefix = "yes-no" }: { onYes: () => void; onNo: () => void; yes?: string; no?: string; disabled?: boolean; answered?: "yes" | "no" | null; testIDPrefix?: string }) {
  const { colors } = useTheme();
  const btn = (k: "yes" | "no") => {
    const on = answered === k;
    const c = k === "yes" ? colors.good : colors.you;
    return (
      <Pressable key={k} testID={`${testIDPrefix}-${k}`} accessibilityRole="button" accessibilityLabel={k === "yes" ? yes : no} disabled={disabled || !!answered} onPress={k === "yes" ? onYes : onNo}
        style={({ pressed }) => ({ flex: 1, minHeight: 48, borderRadius: radius.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 2, borderColor: c,
          backgroundColor: on ? c : kindSoft(colors, k === "yes" ? "good" : "you"), opacity: answered && !on ? 0.4 : pressed ? 0.8 : 1 })}>
        <Ionicons name={k === "yes" ? "checkmark" : "close"} size={20} color={on ? colors.onBrandPrimary : c} />
        <Txt weight="semibold" style={{ fontSize: 15 }} color={on ? colors.onBrandPrimary : c}>{k === "yes" ? yes : no}</Txt>
      </Pressable>
    );
  };
  return <View style={{ flexDirection: "row", gap: spacing.sm }}>{btn("yes")}{btn("no")}</View>;
}

// ---------- Countdown ----------
export function Countdown({ days, total = 30, caption, testID }: { days: number; total?: number; caption?: string; testID?: string }) {
  const { colors } = useTheme();
  const kind: Kind = days < 0 ? "you" : days < 5 ? "waiting" : "good";
  const c = kindColor(colors, kind);
  const size = 60, w = 6, r = (size - w) / 2, circ = 2 * Math.PI * r;
  const frac = days < 0 ? 1 : Math.max(0, Math.min(1, 1 - days / total));
  return (
    <View testID={testID} accessible accessibilityLabel={days < 0 ? `${-days} days overdue` : `${days} days left. ${caption || ""}`} style={{ flexDirection: "row", alignItems: "center", gap: spacing.lg }}>
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Svg width={size} height={size} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.border} strokeWidth={w} fill="none" />
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={c} strokeWidth={w} fill="none" strokeLinecap="round" strokeDasharray={`${circ}`} strokeDashoffset={circ * (1 - frac)} />
        </Svg>
        <Txt weight="bold" style={{ fontSize: 18, lineHeight: 22 }} color={c}>{Math.abs(days)}</Txt>
        <Txt style={{ fontSize: 10, lineHeight: 12 }} color={colors.muted}>{days < 0 ? "late" : days === 1 ? "day" : "days"}</Txt>
      </View>
      {caption ? <Txt v="label" style={{ flex: 1 }}>{caption}</Txt> : null}
    </View>
  );
}

// ---------- More ----------
export function More({ children, label = "More", testID = "more-toggle" }: { children: React.ReactNode; label?: string; testID?: string }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <Animated.View layout={LinearTransition.duration(200)}>
      <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} hitSlop={6} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" }}>
        <Txt v="label" color={colors.brandPrimary}>{open ? "Less" : label}</Txt>
        <Ionicons name={open ? "chevron-up" : "chevron-forward"} size={16} color={colors.brandPrimary} />
      </Pressable>
      {open ? <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} style={{ gap: spacing.sm, paddingBottom: spacing.sm }}>{children}</Animated.View> : null}
    </Animated.View>
  );
}

// ---------- MoneyCard ----------
export function MoneyCard({ amount, what, kind, statusLabel, action, onAction, actionLoading, sign, secondary, more, children, testID, index = 0 }: {
  amount: number; what: string; kind: Kind; statusLabel: string; action?: string; onAction?: () => void; actionLoading?: boolean; sign?: "in" | "out" | "held";
  secondary?: React.ReactNode; more?: React.ReactNode; children?: React.ReactNode; testID?: string; index?: number;
}) {
  const { colors } = useTheme();
  return (
    <StripCard kind={kind} testID={testID} index={index}>
      <View style={{ gap: spacing.sm }}>
        <BigNumber value={amount} sign={sign} testID={testID ? `${testID}-amount` : undefined} />
        <Txt v="label" numberOfLines={2}>{what}</Txt>
        <Status kind={kind} label={statusLabel} size="sm" />
        {children}
        {action && onAction ? (
          <Pressable testID={testID ? `${testID}-action` : undefined} accessibilityRole="button" onPress={onAction} disabled={actionLoading}
            style={({ pressed }) => ({ minHeight: 48, borderRadius: radius.md, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", opacity: pressed || actionLoading ? 0.8 : 1, marginTop: 4 })}>
            <Txt weight="semibold" style={{ fontSize: 16 }} color={colors.onBrandPrimary}>{actionLoading ? "…" : action}</Txt>
          </Pressable>
        ) : null}
        {secondary}
        {more ? <More testID={testID ? `${testID}-more` : undefined}>{more}</More> : null}
      </View>
    </StripCard>
  );
}

// ---------- PhotoPair ----------
function Shot({ id, label, box, onPress }: { id?: string | null; label: string; box?: any; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="imagebutton" accessibilityLabel={`${label} photo, tap to enlarge`} style={{ flex: 1, gap: 4 }}>
      <View style={{ aspectRatio: 1, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surfaceTertiary }}>
        {id ? <FileImage id={id} size={400} style={{ width: "100%", height: "100%", borderRadius: 0 }} /> : <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><Ionicons name="image-outline" size={28} color={colors.muted} /></View>}
        {box ? <View pointerEvents="none" style={{ position: "absolute", left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`, borderWidth: 3, borderColor: colors.you, borderRadius: 4 }} /> : null}
      </View>
      <Txt v="label" style={{ textAlign: "center" }}>{label}</Txt>
    </Pressable>
  );
}
export function PhotoPair({ before, after, box: raw, beforeLabel = "Move-in", afterLabel = "Now", testID }: { before?: string | null; after?: string | null; box?: any; beforeLabel?: string; afterLabel?: string; testID?: string }) {
  const { colors } = useTheme();
  const [big, setBig] = useState<string | null>(null);
  const box = raw && raw.left != null ? { x: raw.left, y: raw.top, w: raw.right - raw.left, h: raw.bottom - raw.top } : raw;
  return (
    <View testID={testID} style={{ flexDirection: "row", gap: spacing.sm }}>
      <Shot id={before} label={beforeLabel} onPress={() => before && setBig(before)} />
      <Shot id={after} label={afterLabel} box={box} onPress={() => after && setBig(after)} />
      <Modal visible={!!big} transparent animationType="fade" onRequestClose={() => setBig(null)}>
        <Pressable testID="photo-full-close" accessibilityLabel="Close photo" onPress={() => setBig(null)} style={{ flex: 1, backgroundColor: colors.overlay, alignItems: "center", justifyContent: "center", padding: spacing.lg }}>
          {big ? <FileImage id={big} size={360} style={{ width: "100%", height: undefined, aspectRatio: 1 }} /> : null}
        </Pressable>
      </Modal>
    </View>
  );
}

// ---------- DocTile ----------
export function DocTile({ name, icon = "document-text", onView, shareUrl, testID }: { name: string; icon?: string; onView: () => void; shareUrl?: string; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onView} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, minHeight: 48 }}>
      <Ionicons name={icon as any} size={20} color={colors.brandPrimary} />
      <Txt v="label" style={{ flex: 1 }} numberOfLines={1}>{name}</Txt>
      <Pressable testID={testID ? `${testID}-view` : undefined} accessibilityLabel={`View ${name}`} onPress={onView} hitSlop={6} style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="eye-outline" size={20} color={colors.brandPrimary} />
      </Pressable>
      {shareUrl ? (
        <Pressable testID={testID ? `${testID}-share` : undefined} accessibilityLabel={`Share ${name}`} onPress={() => Share.share({ message: `${name}: ${shareUrl}`, url: shareUrl }).catch(() => {})} hitSlop={6} style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="share-outline" size={20} color={colors.brandPrimary} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

// ---------- IconRow (timeline, lease summary, expenses) ----------
export function IconRow({ icon, label, value, color, testID }: { icon: string; label: string; value?: string; color?: string; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 44 }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandTertiary }}><Ionicons name={icon as any} size={15} color={color || colors.brandPrimary} /></View>
      <Txt style={{ flex: 1, fontSize: 15 }} numberOfLines={2}>{label}</Txt>
      {value ? <Txt weight="semibold" style={{ fontSize: 15 }}>{value}</Txt> : null}
    </View>
  );
}

// ---------- SuccessBurst ----------
let fireBurst: ((label?: string) => void) | null = null;
/** Big green check + light haptic after a completed action. */
export function burst(label?: string) {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  fireBurst?.(label);
}
export function SuccessBurstHost() {
  const { colors } = useTheme();
  const reduce = useReducedMotion();
  const [b, setB] = useState<{ k: number; label?: string } | null>(null);
  useEffect(() => { fireBurst = (label) => setB({ k: Date.now(), label }); return () => { fireBurst = null; }; }, []);
  useEffect(() => { if (!b) return; const id = setTimeout(() => setB(null), reduce ? 700 : 900); return () => clearTimeout(id); }, [b, reduce]);
  if (!b) return null;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
      <Animated.View key={b.k} testID="success-burst" entering={reduce ? undefined : ZoomIn.duration(300).springify()} exiting={reduce ? undefined : FadeOut.duration(200)}
        style={{ width: 120, height: 120, borderRadius: 60, backgroundColor: colors.good, alignItems: "center", justifyContent: "center", gap: 2 }}>
        <Ionicons name="checkmark" size={56} color={colors.onBrandPrimary} />
        {b.label ? <Txt weight="bold" style={{ fontSize: 16 }} color={colors.onBrandPrimary}>{b.label}</Txt> : null}
      </Animated.View>
    </View>
  );
}

export const _fonts = fonts;
