import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, TextProps, View, ViewStyle, StyleProp, TextInputProps } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown, FadeIn, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import Ionicons from "@react-native-vector-icons/ionicons";
import { fonts, makeStyles, radius, spacing, useTheme, ThemeColors } from "@/src/theme";
import { fileUrl, money } from "@/src/api";
import { usesNativeTabs } from "@/src/navigation";

type Tone = "success" | "warning" | "error" | "brand" | "neutral";

// ---------- status ----------
export function statusLabel(t: any, role: string = "landlord"): string {
  const s = t.status;
  const slot = t.picked_slot?.label;
  switch (s) {
    case "reported":
    case "finding_handyman": return "Finding a handyman";
    case "offered": return role === "handyman" ? "New offer" : "Handyman asked";
    case "awaiting_tenant_time":
      if (role === "tenant") return slot ? `You picked ${slot}` : "Pick a time";
      return slot ? (t.quote_status === "approved" ? `Booking ${slot}` : "Waiting for cost approval") : "Waiting on a time";
    case "booked": return `Visit booked · ${slot || ""}`.trim();
    case "fixed_pending_confirm": return role === "tenant" ? "Is it fixed? Tell us" : "Fixed — waiting for tenant's OK";
    case "payment_pending_approval": return role === "handyman" ? "Payment on the way" : "Fixed — waiting for payment";
    case "closed": return role === "handyman" ? "Paid" : "Done";
    case "self_fix_limit_pending": return "Checking the self-fix limit";
    case "self_fix_approved": return `Fix it yourself · up to ${money(t.approved_amount)}`;
    case "receipt_submitted":
    case "reimbursement_pending_approval": return "Receipt sent — credit pending";
    case "needs_landlord": return "Owner is arranging this";
    case "cancelled": return "Cancelled";
    default: return "In progress";
  }
}
export function statusTone(t: any): Tone {
  const s = t.status;
  if (t.urgency === "emergency" && s !== "closed") return "error";
  if (["booked", "closed"].includes(s)) return s === "closed" ? "neutral" : "success";
  if (["awaiting_tenant_time", "fixed_pending_confirm", "payment_pending_approval", "self_fix_limit_pending", "reimbursement_pending_approval", "needs_landlord"].includes(s)) return "warning";
  if (s === "cancelled") return "neutral";
  return "brand";
}
function toneColors(c: ThemeColors, tone: Tone) {
  return {
    success: [c.successSoft, c.onSuccessSoft], warning: [c.warningSoft, c.onWarningSoft], error: [c.errorSoft, c.onErrorSoft],
    brand: [c.brandSecondary, c.onBrandSecondary], neutral: [c.surfaceTertiary, c.onSurfaceTertiary],
  }[tone];
}

// ---------- text ----------
type V = "title" | "h2" | "body" | "label" | "caption" | "money" | "small";
export function Txt({ v = "body", color, style, weight, ...p }: TextProps & { v?: V; color?: string; weight?: keyof typeof fonts }) {
  const { colors } = useTheme();
  const base: any = {
    title: { fontSize: 30, fontFamily: fonts.bold, letterSpacing: -0.5 },
    h2: { fontSize: 20, fontFamily: fonts.bold },
    body: { fontSize: 16, fontFamily: fonts.regular, lineHeight: 22 },
    label: { fontSize: 15, fontFamily: fonts.semibold },
    caption: { fontSize: 13, fontFamily: fonts.medium, color: colors.muted },
    small: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted },
    money: { fontSize: 30, fontFamily: fonts.extrabold, letterSpacing: -0.5 },
  }[v];
  return <Text {...p} style={[{ color: colors.onSurface }, base, weight ? { fontFamily: fonts[weight] } : null, color ? { color } : null, style]} />;
}

// ---------- layout ----------
export function Screen({ children, scroll = true, padTop = true, tab = false, refresh, testID, footer }: {
  children: React.ReactNode; scroll?: boolean; padTop?: boolean; tab?: boolean; refresh?: React.ReactElement<any>; testID?: string; footer?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const ins = useSafeAreaInsets();
  const bottom = tab ? (usesNativeTabs ? ins.bottom : 0) : ins.bottom;
  const pad = { paddingTop: padTop ? ins.top + spacing.sm : 0, paddingHorizontal: spacing.lg, paddingBottom: bottom + spacing.xl };
  return (
    <View testID={testID} style={{ flex: 1, backgroundColor: colors.surface }}>
      {scroll ? (
        <ScrollView contentContainerStyle={pad} refreshControl={refresh} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView>
      ) : (
        <View style={[{ flex: 1 }, pad]}>{children}</View>
      )}
      {footer}
    </View>
  );
}

export type HeaderAction = { label: string; icon?: any; onPress: () => void; testID: string };
export function LargeHeader({ title, subtitle, actions = [], back }: { title: string; subtitle?: string; actions?: HeaderAction[]; back?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: spacing.xl }}>
      {back ? (
        <Pressable testID="header-back-button" onPress={back} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", minHeight: 44, alignSelf: "flex-start" }}>
          <Ionicons name="chevron-back" size={22} color={colors.brandPrimary} />
          <Txt v="label" color={colors.brandPrimary}>Back</Txt>
        </Pressable>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Txt v="title" accessibilityRole="header">{title}</Txt>
          {subtitle ? <Txt v="body" color={colors.muted} style={{ marginTop: 2 }}>{subtitle}</Txt> : null}
        </View>
        <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: 4 }}>
          {actions.slice(0, 2).map((a) => (
            <Pressable key={a.testID} testID={a.testID} onPress={a.onPress} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, minHeight: 40, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: pressed ? colors.brandSecondary : colors.surfaceTertiary })}>
              {a.icon ? <Ionicons name={a.icon} size={16} color={colors.onSurface} /> : null}
              <Txt v="label" style={{ fontSize: 14 }}>{a.label}</Txt>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

export function Section({ title, children, right, testID }: { title: string; children: React.ReactNode; right?: React.ReactNode; testID?: string }) {
  return (
    <View testID={testID} style={{ marginBottom: spacing.xl }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md }}>
        <Txt v="h2">{title}</Txt>
        {right}
      </View>
      <View style={{ gap: spacing.md }}>{children}</View>
    </View>
  );
}

const useCardStyles = makeStyles((c) => ({
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, borderWidth: 0.5, borderColor: c.border, padding: spacing.lg,
    shadowColor: c.shadow, shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  agent: { backgroundColor: c.brandTertiary, borderColor: c.brandSecondary },
}));
export function Card({ children, style, onPress, testID, agent, index = 0 }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; testID?: string; agent?: boolean; index?: number }) {
  const s = useCardStyles();
  const body = <View style={[s.card, agent && s.agent, style]}>{children}</View>;
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 60).duration(280)}>
      {onPress ? <Pressable testID={testID} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.99 : 1 }] })}>{body}</Pressable> : <View testID={testID}>{body}</View>}
    </Animated.View>
  );
}

export function PhotoCard({ uri, title, subtitle, onPress, testID, index = 0, height = 170 }: { uri?: string; title: string; subtitle?: string; onPress?: () => void; testID?: string; index?: number; height?: number }) {
  const { colors } = useTheme();
  return (
    <Animated.View entering={FadeInDown.delay(index * 60).duration(280)}>
      <Pressable testID={testID} onPress={onPress} style={({ pressed }) => ({ height, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.surfaceTertiary, opacity: pressed ? 0.9 : 1 })}>
        <Image source={{ uri }} style={{ position: "absolute", width: "100%", height: "100%" }} contentFit="cover" transition={200} />
        <LinearGradient colors={["transparent", "rgba(0,0,0,0.72)"]} style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: height * 0.65 }} />
        <View style={{ position: "absolute", left: spacing.lg, right: spacing.lg, bottom: spacing.lg }}>
          <Txt v="h2" color="#FFFFFF">{title}</Txt>
          {subtitle ? <Txt v="label" color="#FFFFFF" style={{ opacity: 0.92, marginTop: 2 }}>{subtitle}</Txt> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ---------- buttons ----------
export function BigButton({ label, onPress, testID, disabled, loading, tone = "brand", icon, style }: { label: string; onPress: () => void; testID: string; disabled?: boolean; loading?: boolean; tone?: "brand" | "danger" | "soft"; icon?: any; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const bg = tone === "danger" ? colors.error : tone === "soft" ? colors.brandSecondary : colors.brandPrimary;
  const fg = tone === "danger" ? colors.onError : tone === "soft" ? colors.onBrandSecondary : colors.onBrandPrimary;
  return (
    <Pressable testID={testID} accessibilityRole="button" disabled={disabled || loading} onPress={onPress}
      style={({ pressed }) => [{ minHeight: 52, borderRadius: radius.md, backgroundColor: bg, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, paddingHorizontal: spacing.lg, opacity: disabled ? 0.45 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : <>{icon ? <Ionicons name={icon} size={20} color={fg} /> : null}<Txt v="label" color={fg} style={{ fontSize: 16 }}>{label}</Txt></>}
    </Pressable>
  );
}
export function TextButton({ label, onPress, testID, color, icon, disabled }: { label: string; onPress: () => void; testID: string; color?: string; icon?: any; disabled?: boolean }) {
  const { colors } = useTheme();
  const c = color || colors.brandPrimary;
  return (
    <Pressable testID={testID} onPress={onPress} disabled={disabled} hitSlop={6} style={({ pressed }) => ({ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 8, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 })}>
      {icon ? <Ionicons name={icon} size={18} color={c} /> : null}
      <Txt v="label" color={c}>{label}</Txt>
    </Pressable>
  );
}

export function StatusPill({ label, tone = "neutral", testID }: { label: string; tone?: Tone; testID?: string }) {
  const { colors } = useTheme();
  const [bg, fg] = toneColors(colors, tone);
  return (
    <View testID={testID} style={{ alignSelf: "flex-start", backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Txt v="caption" color={fg} weight="semibold">{label}</Txt>
    </View>
  );
}

export function Chip({ label, selected, onPress, testID, icon }: { label: string; selected?: boolean; onPress?: () => void; testID: string; icon?: any }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => ({ height: 36, flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: radius.pill,
      backgroundColor: selected ? colors.brandPrimary : colors.surfaceTertiary, borderWidth: 1, borderColor: selected ? colors.brandPrimary : colors.border, opacity: pressed ? 0.8 : 1 })}>
      {icon ? <Ionicons name={icon} size={15} color={selected ? colors.onBrandPrimary : colors.onSurfaceTertiary} /> : null}
      <Txt v="label" style={{ fontSize: 14 }} color={selected ? colors.onBrandPrimary : colors.onSurfaceTertiary}>{label}</Txt>
    </Pressable>
  );
}
export function ChipRow({ children }: { children: React.ReactNode }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, height: 56 }} contentContainerStyle={{ gap: spacing.sm, alignItems: "center" }} keyboardShouldPersistTaps="handled">{children}</ScrollView>;
}

export function Field({ label, hint, testID, style, ...p }: TextInputProps & { label: string; hint?: string; testID: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Txt v="label">{label}</Txt>
      <TextInput testID={testID} placeholderTextColor={colors.muted} {...p}
        style={[{ minHeight: 50, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, fontFamily: fonts.regular, color: colors.onSurface }, p.multiline ? { minHeight: 90, textAlignVertical: "top" } : null, style]} />
      {hint ? <Txt v="small">{hint}</Txt> : null}
    </View>
  );
}

export function Avatar({ name, size = 40, uri }: { name?: string; size?: number; uri?: string | null }) {
  const { colors } = useTheme();
  const init = (name || "?").split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase();
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" }}>
      <Txt v="label" color={colors.onBrandSecondary} style={{ fontSize: size * 0.38 }}>{init}</Txt>
    </View>
  );
}

export function AgentMark({ small }: { small?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Ionicons name="sparkles" size={small ? 12 : 14} color={colors.brandPrimary} />
      <Txt v="caption" color={colors.brandPrimary} weight="semibold">Rentwise</Txt>
    </View>
  );
}

export const STEPS = ["Reported", "Handyman", "Booked", "Fixed", "Paid"];
export function ProgressDots({ step, labels = STEPS, testID }: { step: number; labels?: string[]; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.sm }}>
      {labels.map((l, i) => (
        <View key={l} style={{ flex: 1, gap: 4 }}>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: i <= step ? colors.brandPrimary : colors.surfaceTertiary }} />
          <Txt v="small" style={{ fontSize: 11 }} numberOfLines={1}>{l}</Txt>
        </View>
      ))}
    </View>
  );
}

export function FileImage({ id, size = 90, style, testID }: { id: string; size?: number; style?: any; testID?: string }) {
  const { colors } = useTheme();
  return <Image testID={testID} source={{ uri: fileUrl(id) }} style={[{ width: size, height: size, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary }, style]} contentFit="cover" transition={150} />;
}

// ---------- states ----------
export function EmptyState({ icon = "leaf-outline", title, body, action, onAction, testID }: { icon?: any; title: string; body?: string; action?: string; onAction?: () => void; testID: string }) {
  const { colors } = useTheme();
  return (
    <Card testID={testID} style={{ alignItems: "flex-start", gap: spacing.sm }}>
      <Ionicons name={icon} size={26} color={colors.brandPrimary} />
      <Txt v="label">{title}</Txt>
      {body ? <Txt v="body" color={colors.muted}>{body}</Txt> : null}
      {action && onAction ? <BigButton testID={`${testID}-action`} label={action} onPress={onAction} tone="soft" style={{ alignSelf: "stretch", marginTop: spacing.sm }} /> : null}
    </Card>
  );
}
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable testID="error-retry" onPress={onRetry} style={{ padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.errorSoft, marginBottom: spacing.md }}>
      <Txt v="label" color={colors.onErrorSoft}>{message}</Txt>
      <Txt v="small" color={colors.onErrorSoft}>Tap to try again</Txt>
    </Pressable>
  );
}
export function Skeleton({ height = 90, count = 3 }: { height?: number; count?: number }) {
  const { colors } = useTheme();
  const o = useSharedValue(0.5);
  useEffect(() => { o.value = withRepeat(withTiming(1, { duration: 700 }), -1, true); }, [o]);
  const st = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <View testID="skeleton" style={{ gap: spacing.md }}>
      {Array.from({ length: count }).map((_, i) => <Animated.View key={i} style={[{ height, borderRadius: radius.lg, backgroundColor: colors.surfaceTertiary }, st]} />)}
    </View>
  );
}

// ---------- sheets ----------
export function Sheet({ visible, onClose, children, title, testID }: { visible: boolean; onClose: () => void; children: React.ReactNode; title?: string; testID?: string }) {
  const { colors } = useTheme();
  const ins = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: colors.overlay }} onPress={onClose} testID={testID ? `${testID}-backdrop` : undefined} />
      <View testID={testID} style={{ backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.xl, paddingBottom: ins.bottom + spacing.xl, maxHeight: "88%" }}>
        <View style={{ alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: spacing.lg }} />
        {title ? <Txt v="h2" style={{ marginBottom: spacing.lg }}>{title}</Txt> : null}
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView>
      </View>
    </Modal>
  );
}

export function ConfirmSheet({ visible, onClose, title, amount, body, confirmLabel, onConfirm, loading, danger, testID = "confirm-sheet" }: {
  visible: boolean; onClose: () => void; title: string; amount?: number | null; body?: string; confirmLabel: string; onConfirm: () => void; loading?: boolean; danger?: boolean; testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} testID={testID}>
      <Txt v="h2">{title}</Txt>
      {amount != null ? <Txt v="money" style={{ fontSize: 44, marginVertical: spacing.md }} testID={`${testID}-amount`}>{money(amount)}</Txt> : null}
      {body ? <Txt v="body" color={colors.muted} style={{ marginBottom: spacing.lg }}>{body}</Txt> : null}
      <BigButton testID={`${testID}-confirm`} label={confirmLabel} onPress={onConfirm} loading={loading} tone={danger ? "danger" : "brand"} />
      <TextButton testID={`${testID}-cancel`} label="Not now" onPress={onClose} color={colors.muted} />
    </Sheet>
  );
}

// ---------- toast ----------
const ToastCtx = createContext<(msg: string, tone?: "success" | "error") => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [t, setT] = useState<{ msg: string; tone: string; k: number } | null>(null);
  const ins = useSafeAreaInsets();
  const { colors } = useTheme();
  const show = useCallback((msg: string, tone: "success" | "error" = "success") => {
    if (tone === "success") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setT({ msg, tone, k: Date.now() });
  }, []);
  useEffect(() => { if (!t) return; const id = setTimeout(() => setT(null), 3200); return () => clearTimeout(id); }, [t]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t ? (
        <Animated.View key={t.k} entering={FadeIn.duration(180)} pointerEvents="none" style={{ position: "absolute", left: spacing.lg, right: spacing.lg, top: ins.top + spacing.sm }}>
          <View testID="toast" style={{ backgroundColor: t.tone === "error" ? colors.error : colors.surfaceInverse, borderRadius: radius.md, padding: spacing.lg, flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Ionicons name={t.tone === "error" ? "alert-circle" : "checkmark-circle"} size={20} color={t.tone === "error" ? colors.onError : colors.onSurfaceInverse} />
            <Txt v="label" color={t.tone === "error" ? colors.onError : colors.onSurfaceInverse} style={{ flex: 1 }}>{t.msg}</Txt>
          </View>
        </Animated.View>
      ) : null}
    </ToastCtx.Provider>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap: spacing.md }, style]}>{children}</View>;
}
export function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: 0.5, backgroundColor: colors.divider, marginVertical: spacing.sm }} />;
}
export { Ionicons };
