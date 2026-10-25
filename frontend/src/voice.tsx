import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable } from "react-native";
import { AudioModule, RecordingPresets, createAudioPlayer, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { API, authedUrl, session } from "@/src/api";
import { uploadForm } from "@/src/utils/upload";
import { Ionicons, useToast } from "@/src/ui";
import { useTheme } from "@/src/theme";

// One player for the whole app, so only one reply is ever read aloud at a time.
const player = createAudioPlayer(null);
let playingId: string | null = null;
const listeners = new Set<(id: string | null) => void>();
const setPlaying = (id: string | null) => { playingId = id; listeners.forEach((l) => l(id)); };
let failListener: (() => void) | null = null;
player.addListener("playbackStatusUpdate", (s: any) => {
  if (s.didJustFinish) setPlaying(null);
  if (s.error && playingId) { setPlaying(null); failListener?.(); }
});

export function stopSpeaking() {
  try { player.pause(); } catch {}
  setPlaying(null);
}

/** Read one agent reply aloud; replaces whatever is playing. */
export async function speak(messageId: string, onFail?: () => void) {
  await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
  player.replace({ uri: authedUrl(`/voice/tts/${messageId}.mp3`) });
  failListener = onFail || null;
  player.play();
  setPlaying(messageId);
}

/** Play button on an agent reply (text to speech). */
export function SpeakButton({ messageId }: { messageId: string }) {
  const { colors } = useTheme();
  const toast = useToast();
  const [cur, setCur] = useState(playingId);
  const [loading, setLoading] = useState(false);
  useEffect(() => { listeners.add(setCur); return () => { listeners.delete(setCur); }; }, []);
  const on = cur === messageId;
  const press = async () => {
    if (on) { stopSpeaking(); return; }
    setLoading(true);
    try {
      await speak(messageId, () => toast("Couldn't read this aloud. Tap to try again", "error"));
    } catch { toast("Couldn't read this aloud. Tap to try again", "error"); setPlaying(null); } finally { setLoading(false); }
  };
  return (
    <Pressable testID={`speak-${messageId}`} accessibilityLabel={on ? "Stop reading" : "Read aloud"} onPress={press} hitSlop={10} style={{ alignSelf: "flex-start", minWidth: 44, minHeight: 44, justifyContent: "center" }}>
      {loading ? <ActivityIndicator size="small" color={colors.brand} /> : <Ionicons name={on ? "stop-circle" : "volume-high-outline"} size={22} color={colors.brandPrimary} />}
    </Pressable>
  );
}

/** Tap to talk, tap again to stop; the transcript is added to the message box (speech to text). */
export function MicButton({ onText, disabled }: { onText: (t: string) => void; disabled?: boolean }) {
  const { colors } = useTheme();
  const toast = useToast();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [state, setState] = useState<"idle" | "listening" | "thinking">("idle");
  const preparing = useRef(false);
  const watchdog = useRef<any>(null);
  useEffect(() => () => {
    clearTimeout(watchdog.current);
    try { if (recorder.isRecording) recorder.stop().catch(() => {}); } catch {}
  }, [recorder]);

  const stop = async () => {
    clearTimeout(watchdog.current);
    setState("thinking");
    try {
      await recorder.stop();
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      const uri = recorder.uri;
      if (!uri) throw new Error("No recording");
      const headers: Record<string, string> = { Authorization: `Bearer ${session.token}` };
      if (session.actAs) headers["X-Act-As"] = session.actAs;
      const file = Platform.OS === "web" ? { uri, name: "recording.webm", mimeType: "audio/webm" } : { uri, name: "recording.m4a", mimeType: "audio/m4a" };
      const res: any = await uploadForm(`${API}/voice/transcribe`, { headers, files: { audio: file } });
      let data: any = res;
      if (typeof res?.json === "function") { try { data = await res.json(); } catch { data = {}; } }
      if (res?.ok === false) throw new Error(typeof data?.detail === "string" ? data.detail : "I couldn't hear that clearly. Please try again");
      if (data?.text) onText(data.text); else toast("Didn't catch that — tap the mic and try again", "error");
    } catch (e: any) { toast(e.message || "I couldn't hear that clearly. Please try again", "error"); } finally { setState("idle"); }
  };

  const start = async () => {
    if (preparing.current) return;
    preparing.current = true;
    try {
      stopSpeaking();
      const cur = await AudioModule.getRecordingPermissionsAsync();
      const perm = cur.granted ? cur : cur.canAskAgain ? await AudioModule.requestRecordingPermissionsAsync() : cur;
      if (!perm.granted) {
        if (!perm.canAskAgain) { toast("Microphone is off for Rentwise. Turn it on in Settings to talk", "error"); Linking.openSettings(); }
        else toast("Microphone access is needed to talk to Rentwise", "error");
        return;
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setState("listening");
      watchdog.current = setTimeout(stop, 60000);
    } catch { toast("Couldn't start the microphone. Please try again", "error"); setState("idle"); } finally { preparing.current = false; }
  };

  const listening = state === "listening";
  return (
    <Pressable testID="chat-mic-button" accessibilityLabel={listening ? "Stop recording" : "Talk"} disabled={disabled || state === "thinking"} onPress={listening ? stop : start}
      style={{ height: 44, width: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: listening ? colors.error : colors.surfaceTertiary }}>
      {state === "thinking" ? <ActivityIndicator color={colors.brand} /> : <Ionicons name={listening ? "stop" : "mic-outline"} size={20} color={listening ? colors.onBrandPrimary : colors.onSurface} />}
    </Pressable>
  );
}
