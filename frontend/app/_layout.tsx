import React, { useEffect } from "react";
import { StyleSheet, View, ActivityIndicator, Pressable } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { useFonts } from "expo-font";
import { LogBox } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { QueryClientProvider } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Ionicons from "@react-native-vector-icons/ionicons";
import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { AuthProvider, useAuth } from "@/src/auth";
import { ToastProvider, Txt } from "@/src/ui";
import { SuccessBurstHost } from "@/src/visual";
import { useTheme, spacing } from "@/src/theme";

LogBox.ignoreAllLogs(true);

function targetFor(me: any): string {
  const u = me?.user;
  if (!u) return "login";
  if (!u.role) return "welcome";
  if (u.role === "tenant" && !me.unit) return "welcome";
  if (u.role === "handyman" && !me.handyman) return "welcome";
  return `(${u.role})`;
}
const SHARED = ["ticket", "thread", "property", "handyman", "settings", "lease", "report", "rights", "accept", "statement", "inspection", "visual-qa"];

function Gate() {
  const { me, loading, actAs } = useAuth();
  const segs = useSegments();
  const router = useRouter();
  const { colors, scheme } = useTheme();
  const ins = useSafeAreaInsets();
  useEffect(() => {
    if (loading) return;
    const want = targetFor(me);
    const cur = segs[0] as string | undefined;
    if (cur === want) return;
    if (me?.user?.role && want.startsWith("(") && cur && SHARED.includes(cur)) return;
    if (want === "welcome" && cur === "welcome") return;
    router.replace(want === "login" ? "/login" : want === "welcome" ? "/welcome" : (`/${want}` as any));
  }, [me, loading, segs, router]);
  if (loading) {
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}><ActivityIndicator color={colors.brandPrimary} /></View>;
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      {me?.acting ? (
        <Pressable testID="acting-banner-switch-back" onPress={() => { actAs(null); router.replace("/(landlord)" as any); }} style={{ paddingTop: ins.top + 6, paddingBottom: 8, paddingHorizontal: spacing.lg, backgroundColor: colors.brandPrimary, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Ionicons name="swap-horizontal" size={18} color={colors.onBrandPrimary} />
          <Txt v="label" color={colors.onBrandPrimary} style={{ flex: 1 }}>You&apos;re viewing as {me.user.name.split(" ")[0]} (sample) — Switch back</Txt>
        </Pressable>
      ) : null}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />
      <SuccessBurstHost />
    </View>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({
    "PJS-400": require("../assets/fonts/PJS-400.ttf"),
    "PJS-500": require("../assets/fonts/PJS-500.ttf"),
    "PJS-600": require("../assets/fonts/PJS-600.ttf"),
    "PJS-700": require("../assets/fonts/PJS-700.ttf"),
    "PJS-800": require("../assets/fonts/PJS-800.ttf"),
    ...(Ionicons as any).font,
  });
  if (!loaded) return null;
  return (
    <GestureHandlerRootView style={styles.root}>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <KeyboardProvider>
            <AuthProvider>
              <ToastProvider>
                <Gate />
              </ToastProvider>
            </AuthProvider>
          </KeyboardProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
