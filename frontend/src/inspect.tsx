import React, { useEffect } from "react";
import { Pressable, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { fileUrl } from "@/src/api";
import { FileImage, StatusPill, Txt } from "@/src/ui";
import { radius, spacing, useTheme } from "@/src/theme";

export const CAT_LABEL: Record<string, string> = { damage: "Charge", normal_wear: "Normal wear", pre_existing: "Already there", reported_repair: "Reported repair", check: "Check" };

export const mmss = (t?: number | null) => (t == null ? "" : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`);

/** Frame with an optional red rounded damage box (fractions 0–1). */
export function Frame({ id, box, size = 150, label, onPress, testID }: { id?: string | null; box?: any; size?: number; label?: string; onPress?: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={{ flex: 1, gap: 4 }} testID={testID}>
      <View style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surfaceTertiary }}>
        {id ? <FileImage id={id} size={size} style={{ width: "100%", height: "100%" }} /> : <Txt v="small" style={{ padding: spacing.md }}>No photo</Txt>}
        {box ? (
          <View pointerEvents="none" style={{ position: "absolute", left: `${box.left * 100}%`, top: `${box.top * 100}%`, width: `${(box.right - box.left) * 100}%`, height: `${(box.bottom - box.top) * 100}%`,
            borderWidth: 3, borderColor: colors.error, borderRadius: 10 }} />
        ) : null}
      </View>
      {label ? <Txt v="small" numberOfLines={1}>{label}</Txt> : null}
    </Pressable>
  );
}

export function Video({ fileId, start = 0, testID }: { fileId: string; start?: number; testID?: string }) {
  const player = useVideoPlayer(fileUrl(fileId) || null, (p) => { p.loop = false; });
  useEffect(() => { if (start) { player.currentTime = start; player.play(); } }, [start, player]);
  return <View testID={testID}><VideoView player={player} nativeControls contentFit="contain" style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: radius.md, backgroundColor: "#000" }} /></View>;
}

export function Countdown({ daysLeft, dueBy }: { daysLeft: number; dueBy: string }) {
  const tone = daysLeft < 0 ? "error" : daysLeft <= 5 ? "warning" : "brand";
  return <StatusPill testID="countdown-pill" tone={tone as any} label={daysLeft < 0 ? `Overdue since ${dueBy}` : `${daysLeft} days left · due ${dueBy}`} />;
}
