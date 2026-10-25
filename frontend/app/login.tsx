import React from "react";
import { useWindowDimensions, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import { useAuth } from "@/src/auth";
import { BigButton, Txt, Ionicons } from "@/src/ui";
import { AgentTicker } from "@/src/AgentTicker";
import { spacing, useTheme } from "@/src/theme";


export default function Login() {
  const { signIn, signingIn, error } = useAuth();
  const { colors } = useTheme();
  const ins = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const compact = height < 760;
  const big = Math.min(compact ? 46 : 56, Math.floor((width - 48) / 7.2));
  return (
    <View testID="login-screen" style={{ flex: 1, backgroundColor: colors.surface, overflow: "hidden" }}>
      <LinearGradient colors={[colors.brandSecondary, colors.brandTertiary, colors.surface]} locations={[0, 0.45, 0.8]} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} />
      {/* soft background orbs */}
      <View pointerEvents="none" style={{ position: "absolute", width: 260, height: 260, borderRadius: 130, backgroundColor: colors.brandSecondary, opacity: 0.6, top: -80, right: -90 }} />
      <View pointerEvents="none" style={{ position: "absolute", width: 180, height: 180, borderRadius: 90, backgroundColor: colors.brandTertiary, opacity: 0.8, top: height * 0.3, left: -70 }} />

      <View style={{ flex: 1, paddingTop: ins.top + spacing.md, paddingHorizontal: spacing.xl, paddingBottom: Math.max(ins.bottom, spacing.lg) + spacing.sm }}>
        <Animated.View entering={FadeIn.duration(500)} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="sparkles" size={17} color={colors.onBrandPrimary} />
          </View>
          <Txt v="h2">Doorman</Txt>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(500).delay(100)} style={{ flex: 1, justifyContent: "center", gap: spacing.md }}>
          <Txt testID="login-headline" v="title" style={{ fontSize: big, lineHeight: Math.round(big * 1.08), letterSpacing: -1.5 }}>
            Your rental,{"\n"}<Txt v="title" color={colors.brandPrimary} style={{ fontSize: big, lineHeight: Math.round(big * 1.08), letterSpacing: -1.5 }}>running itself.</Txt>
          </Txt>
          <Txt v="body" color={colors.onSurfaceTertiary} style={{ fontSize: 18, lineHeight: 26 }}>An AI doorman for your homes. Rent, repairs and tenants handled. You just OK the money.</Txt>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(450).delay(250)} style={{ gap: compact ? spacing.sm : spacing.md }}>
          <AgentTicker />
          {error ? <Txt testID="login-error" v="label" color={colors.error}>{error}</Txt> : null}
          <BigButton testID="login-google-button" icon="logo-google" label="Continue with Google" onPress={signIn} loading={signingIn} style={{ marginTop: compact ? 0 : spacing.sm }} />
          <Txt v="small" style={{ textAlign: "center" }}>For landlords, tenants and handymen</Txt>
        </Animated.View>
      </View>
    </View>
  );
}
