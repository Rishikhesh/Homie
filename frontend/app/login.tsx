import React from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useAuth } from "@/src/auth";
import { HERO_PHOTO } from "@/src/api";
import { BigButton, Txt, Ionicons } from "@/src/ui";
import { spacing, useTheme } from "@/src/theme";

export default function Login() {
  const { signIn, signingIn, error } = useAuth();
  const { colors } = useTheme();
  const ins = useSafeAreaInsets();
  return (
    <View testID="login-screen" style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ height: "58%" }}>
        <Image source={{ uri: HERO_PHOTO }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={300} />
        <LinearGradient colors={["transparent", colors.surface]} style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "60%" }} />
      </View>
      <Animated.View entering={FadeInDown.duration(400)} style={{ flex: 1, paddingHorizontal: spacing.xl, paddingBottom: ins.bottom + spacing.xl, justifyContent: "flex-end", gap: spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Ionicons name="sparkles" size={22} color={colors.brandPrimary} />
          <Txt v="title" style={{ fontSize: 34 }}>Rentwise</Txt>
        </View>
        <Txt v="body" style={{ fontSize: 18, lineHeight: 26 }} color={colors.muted}>Your rental runs itself. Rentwise handles tenants and repairs — you just approve the money.</Txt>
        {error ? <Txt testID="login-error" v="label" color={colors.error}>{error}</Txt> : null}
        <BigButton testID="login-google-button" icon="logo-google" label="Continue with Google" onPress={signIn} loading={signingIn} style={{ marginTop: spacing.lg }} />
      </Animated.View>
    </View>
  );
}
