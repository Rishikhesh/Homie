// Homi calling a handyman: ringing → in call (hold to talk) → ended. Landlords open the same route read-only as a transcript.
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { router as nav, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { AudioModule, RecordingPresets, createAudioPlayer, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { API, api, authedUrl, session } from "@/src/api";
import { useAuth } from "@/src/auth";
import { uploadForm } from "@/src/utils/upload";
import { Ionicons, LargeHeader, Screen, Skeleton, TextButton, Txt, useToast } from "@/src/ui";
import { burst } from "@/src/visual";
import { radius, spacing, useTheme } from "@/src/theme";

const player = createAudioPlayer(null);
const play = async (path?: string | null) => {
  if (!path) return;
  try { await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }); player.replace({ uri: authedUrl(path) }); player.play(); } catch {}
};
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
/** Back if there's somewhere to go back to (opened by link / after reload → home). */
const leave = () => (nav.canGoBack() ? nav.back() : nav.replace("/"));

function PulseRing({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const reduce = useReducedMotion();
  const s = useSharedValue(1);
  useEffect(() => { if (!reduce) s.value = withRepeat(withTiming(1.25, { duration: 900 }), -1, true); }, [reduce, s]);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: s.value }], opacity: 2 - s.value }));
  return (
    <View style={{ width: 150, height: 150, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={[{ position: "absolute", width: 150, height: 150, borderRadius: 75, backgroundColor: colors.brandTertiary }, st]} />
      {children}
    </View>
  );
}

function Avatar() {
  const { colors } = useTheme();
  return <View style={{ width: 104, height: 104, borderRadius: 52, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" }}><Txt style={{ fontSize: 44 }} color={colors.onBrandPrimary}>✦</Txt></View>;
}

function Bubble({ who, text, audio }: { who: string; text: string; audio?: string | null }) {
  const { colors } = useTheme();
  const me = who === "handyman";
  return (
    <View style={{ alignSelf: me ? "flex-end" : "flex-start", maxWidth: "85%", padding: spacing.md, borderRadius: radius.lg, backgroundColor: me ? colors.brandPrimary : colors.surfaceTertiary, flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
      <Txt v="body" style={{ flexShrink: 1 }} color={me ? colors.onBrandPrimary : undefined}>{text}</Txt>
      {!me && audio ? <Pressable accessibilityLabel="Play" onPress={() => play(audio)} hitSlop={8}><Ionicons name="play-circle" size={26} color={colors.brandPrimary} /></Pressable> : null}
    </View>
  );
}

function Transcript({ c }: { c: any }) {
  const router = useRouter();
  return (
    <Screen testID="call-transcript-screen">
      <LargeHeader title="Call" subtitle={`${c.handyman_name.split(" ")[0]} · ${mmss(c.duration_s || 0)} · ${c.outcome === "accepted" ? "accepted" : c.outcome === "declined" ? "said no" : c.outcome === "no_answer" ? "no answer" : "undecided"}`} back={() => leave()} />
      {c.summary ? <Txt v="label" style={{ marginBottom: spacing.lg }}>{c.summary}</Txt> : null}
      <View style={{ gap: spacing.sm }}>
        {c.turns.length ? c.turns.map((t: any, i: number) => <Bubble key={i} who={t.who} text={t.text} audio={t.audio_url} />) : <Txt v="body">No one talked on this call.</Txt>}
      </View>
    </Screen>
  );
}

export default function CallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { me } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const rec = useAudioRecorderState(recorder, 120);
  const [c, setC] = useState<any>(null);
  const [turns, setTurns] = useState<any[]>([]);
  const [state, setState] = useState<"ringing" | "connecting" | "active" | "thinking" | "ended">("ringing");
  const [elapsed, setElapsed] = useState(0);
  const [typing, setTyping] = useState(false);
  const [txt, setTxt] = useState("");
  const answeredAt = useRef<number>(0);
  const scroll = useRef<any>(null);
  const isHandyman = me?.user?.role === "handyman";

  useEffect(() => { api(`/calls/${id}`).then((x) => { setC(x); setTurns(x.turns || []); if (x.status === "active") { answeredAt.current = new Date(x.answered_at).getTime(); setState("active"); } else if (x.status !== "ringing") setState("ended"); }).catch((e) => toast(e.message, "error")); }, [id, toast]);
  // ringing: buzz every 1.5 s; the call times out server-side → back to Jobs
  useEffect(() => {
    if (state !== "ringing" || !c || !isHandyman) return;
    const buzz = setInterval(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}), 1500);
    const poll = setInterval(async () => { try { const r = await api("/calls/incoming"); if (!r.call || r.call.id !== id) { toast("Missed call. The job is in your messages"); leave(); } } catch {} }, 3000);
    return () => { clearInterval(buzz); clearInterval(poll); };
  }, [state, c, isHandyman, id, router, toast]);
  useEffect(() => {
    if (!["active", "thinking"].includes(state)) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - answeredAt.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [state]);
  useEffect(() => { setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50); }, [turns.length]);
  useEffect(() => () => { try { player.pause(); } catch {} }, []);

  if (!c) return <Screen><Skeleton /></Screen>;
  if (!isHandyman || (state === "ended" && c.status !== "active" && !turns.length)) return <Transcript c={{ ...c, turns }} />;

  const answer = async () => {
    setState("connecting");
    try {
      const r = await api(`/calls/${id}/answer`, { method: "POST" });
      answeredAt.current = Date.now();
      setTurns([{ who: "agent", text: r.text, audio_url: r.audio_url }]);
      setState("active");
      play(r.audio_url);
    } catch (e: any) { toast(e.message, "error"); leave(); }
  };
  const decline = async () => { try { await api(`/calls/${id}/decline`, { method: "POST" }); } catch {} leave(); };
  const hangup = async () => {
    try { player.pause(); } catch {}
    try { const r = await api(`/calls/${id}/hangup`, { method: "POST" }); toast(r.summary ? `Call ended · ${r.summary}` : "Call ended"); } catch {}
    leave();
  };
  const handle = (r: any) => {
    setTurns((cur) => [...cur, ...(r.heard ? [{ who: "handyman", text: r.heard }] : []), { who: "agent", text: r.text, audio_url: r.audio_url }]);
    play(r.audio_url);
    if (r.ended) {
      setState("ended");
      if (r.outcome === "accepted") burst("Sent");
      setTimeout(() => leave(), 4000);
    } else setState("active");
  };
  const sendTyped = async () => {
    const t = txt.trim();
    if (!t) return;
    setTxt(""); setState("thinking");
    try { handle(await api(`/calls/${id}/say`, { body: { text: t } })); } catch (e: any) { toast(e.message || "Didn't go through. Try again", "error"); setState("active"); }
  };
  const startTalk = async () => {
    try {
      try { player.pause(); } catch {}
      const cur = await AudioModule.getRecordingPermissionsAsync();
      const perm = cur.granted ? cur : cur.canAskAgain ? await AudioModule.requestRecordingPermissionsAsync() : cur;
      if (!perm.granted) {
        if (!perm.canAskAgain) toast("Microphone is off. Turn it on in Settings, or type instead", "error"); else toast("Homi needs the microphone to hear you. You can type instead", "error");
        if (!perm.canAskAgain) Linking.openSettings();
        setTyping(true);
        return;
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } catch { toast("Couldn't start the microphone. Type instead", "error"); setTyping(true); }
  };
  const stopTalk = async () => {
    if (!recorder.isRecording) return;
    setState("thinking");
    try {
      await recorder.stop();
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      const uri = recorder.uri;
      if (!uri) throw new Error("No recording");
      const headers: Record<string, string> = { Authorization: `Bearer ${session.token}` };
      const file = Platform.OS === "web" ? { uri, name: "turn.webm", mimeType: "audio/webm" } : { uri, name: "turn.m4a", mimeType: "audio/m4a" };
      const res: any = await uploadForm(`${API}/calls/${id}/turn`, { headers, files: { audio: file } });
      let data: any = res;
      if (typeof res?.json === "function") { try { data = await res.json(); } catch { data = {}; } }
      if (res?.ok === false) throw new Error(typeof data?.detail === "string" ? data.detail : "Didn't go through");
      handle(data);
    } catch (e: any) { toast(`${e.message || "Didn't go through"}. Try again`, "error"); setState("active"); }
  };

  if (state === "ringing" || state === "connecting") {
    return (
      <View testID="incoming-call-screen" style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xl, alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ alignItems: "center", gap: spacing.lg }}>
          <PulseRing><Avatar /></PulseRing>
          <Txt v="title">Homi is calling</Txt>
          <Txt v="body" style={{ textAlign: "center", paddingHorizontal: spacing.xl }}>New job · {c.title}</Txt>
        </View>
        <View style={{ flexDirection: "row", gap: spacing.xxl }}>
          <View style={{ alignItems: "center", gap: spacing.sm }}>
            <Pressable testID="call-decline" accessibilityLabel="Decline" onPress={decline} disabled={state === "connecting"} style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: colors.you, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="call" size={32} color={colors.onError} style={{ transform: [{ rotate: "135deg" }] }} />
            </Pressable>
            <Txt v="label">Decline</Txt>
          </View>
          <View style={{ alignItems: "center", gap: spacing.sm }}>
            <Pressable testID="call-answer" accessibilityLabel="Answer" onPress={answer} disabled={state === "connecting"} style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: colors.good, alignItems: "center", justifyContent: "center" }}>
              {state === "connecting" ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Ionicons name="call" size={32} color={colors.onBrandPrimary} />}
            </Pressable>
            <Txt v="label">Answer</Txt>
          </View>
        </View>
      </View>
    );
  }

  const level = rec.isRecording && rec.metering != null ? Math.max(0, Math.min(1, (rec.metering + 60) / 60)) : 0;
  return (
    <View testID="in-call-screen" style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md }}>
      <View style={{ alignItems: "center", gap: 4, paddingBottom: spacing.md }}>
        <Txt v="h2">Homi</Txt>
        <Txt testID="call-timer" v="label" color={colors.muted}>{state === "ended" ? "Call ended" : mmss(elapsed)}</Txt>
      </View>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}>
        {turns.map((t, i) => <Bubble key={i} who={t.who} text={t.text} audio={t.audio_url} />)}
        {state === "thinking" ? <View testID="call-thinking" style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}><ActivityIndicator color={colors.brandPrimary} /><Txt v="label" color={colors.muted}>Homi is thinking…</Txt></View> : null}
      </ScrollView>
      {state !== "ended" ? (
        <View style={{ alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg }}>
          {typing ? (
            <View style={{ flexDirection: "row", gap: spacing.sm, alignSelf: "stretch" }}>
              <TextInput testID="call-type-input" value={txt} onChangeText={setTxt} placeholder="Type your answer" placeholderTextColor={colors.muted} onSubmitEditing={sendTyped}
                style={{ flex: 1, minHeight: 48, borderRadius: radius.md, paddingHorizontal: spacing.md, backgroundColor: colors.surfaceTertiary, color: colors.onSurface, fontSize: 16 }} />
              <Pressable testID="call-type-send" accessibilityLabel="Send" onPress={sendTyped} disabled={state === "thinking"} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="arrow-up" size={20} color={colors.onBrandPrimary} />
              </Pressable>
            </View>
          ) : (
            <Pressable testID="call-hold-to-talk" accessibilityLabel="Hold to talk" onPressIn={startTalk} onPressOut={stopTalk} disabled={state === "thinking"}
              style={{ width: 112, height: 112, borderRadius: 56, alignItems: "center", justifyContent: "center", backgroundColor: rec.isRecording ? colors.you : colors.brandPrimary, opacity: state === "thinking" ? 0.5 : 1,
                borderWidth: 6 + level * 10, borderColor: rec.isRecording ? colors.youSoft : colors.brandTertiary }}>
              <Ionicons name="mic" size={40} color={colors.onBrandPrimary} />
            </Pressable>
          )}
          {!typing ? <Txt v="label">{rec.isRecording ? "Listening… let go to send" : "Hold to talk"}</Txt> : null}
          <TextButton testID="call-type-toggle" label={typing ? "Talk instead" : "Type instead"} onPress={() => setTyping(!typing)} />
          <Pressable testID="call-hangup" accessibilityLabel="Hang up" onPress={hangup} style={{ minWidth: 200, height: 56, borderRadius: 28, backgroundColor: colors.you, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: spacing.sm }}>
            <Ionicons name="call" size={22} color={colors.onError} style={{ transform: [{ rotate: "135deg" }] }} />
            <Txt v="label" color={colors.onError}>Hang up</Txt>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
