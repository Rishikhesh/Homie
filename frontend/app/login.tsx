import React from "react";
import { useWindowDimensions, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import { useAuth } from "@/src/auth";
import { BigButton, Txt, Ionicons } from "@/src/ui";
import { LoginHero } from "@/src/LoginHero";
import { radius, spacing, useTheme } from "@/src/theme";

const POINTS = [
  { icon: "construct", text: "Repairs handled" },
  { icon: "cash", text: "Rent tracked" },
  { icon: "thumbs-up", text: "You OK the money" },
];

export default function Login() {
  const { signIn, signingIn, error } = useAuth();
  const { colors } = useTheme();
  const ins = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const hero = Math.min(width - 48, height * 0.42, 380);
  return (
    <View testID="login-screen" style={{ flex: 1, backgroundColor: colors.surface }}>
      <LinearGradient colors={[colors.brandSecondary, colors.brandTertiary, colors.surface]} locations={[0, 0.45, 0.8]} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} />
      {/* soft background orbs */}
      <View pointerEvents="none" style={{ position: "absolute", width: 260, height: 260, borderRadius: 130, backgroundColor: colors.brandSecondary, opacity: 0.6, top: -80, right: -90 }} />
      <View pointerEvents="none" style={{ position: "absolute", width: 180, height: 180, borderRadius: 90, backgroundColor: colors.brandTertiary, opacity: 0.8, top: height * 0.3, left: -70 }} />

      <View style={{ flex: 1, paddingTop: ins.top + spacing.lg, paddingHorizontal: spacing.xl, paddingBottom: ins.bottom + spacing.xl, justifyContent: "space-between" }}>
        <Animated.View entering={FadeIn.duration(500)} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="sparkles" size={17} color={colors.onBrandPrimary} />
          </View>
          <Txt v="h2">Doorman</Txt>
        </Animated.View>

        <Animated.View entering={FadeIn.duration(700).delay(100)}><LoginHero size={hero} /></Animated.View>

        <Animated.View entering={FadeInDown.duration(450).delay(200)} style={{ gap: spacing.md }}>
          <Txt v="title" style={{ fontSize: 32, lineHeight: 38 }}>Your rental,{"\n"}running itself.</Txt>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {POINTS.map((p) => (
              <View key={p.text} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 0.5, borderColor: colors.border }}>
                <Ionicons name={p.icon as any} size={15} color={colors.brandPrimary} />
                <Txt v="label" style={{ fontSize: 14 }}>{p.text}</Txt>
              </View>
            ))}
          </View>
          {error ? <Txt testID="login-error" v="label" color={colors.error}>{error}</Txt> : null}
          <BigButton testID="login-google-button" icon="logo-google" label="Continue with Google" onPress={signIn} loading={signingIn} style={{ marginTop: spacing.sm }} />
          <Txt v="small" style={{ textAlign: "center" }}>For landlords, tenants and handymen</Txt>
        </Animated.View>
      </View>
    </View>
  );
}
