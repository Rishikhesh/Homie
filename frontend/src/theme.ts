// Rentwise design tokens (plan section 2A). Light + dark. Components read colors via useTheme()/makeStyles.
import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#F9F9F8",
  onSurface: "#1C1C1E",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#1C1C1E",
  surfaceTertiary: "#F0F0EE",
  onSurfaceTertiary: "#3A3A3C",
  surfaceInverse: "#1C1C1E",
  onSurfaceInverse: "#F2F2F2",
  muted: "#8E8E93",
  brand: "#4A6B53",
  onBrand: "#FFFFFF",
  brandPrimary: "#4A6B53",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#E3EBE5",
  onBrandSecondary: "#2F4A37",
  brandTertiary: "#F2F6F3",
  onBrandTertiary: "#2F4A37",
  success: "#34C759",
  onSuccess: "#FFFFFF",
  successSoft: "#E4F7E9",
  onSuccessSoft: "#1E7A37",
  warning: "#B26A00", // text + icons; bright yellow only as a soft background
  onWarning: "#FFFFFF",
  warningSoft: "#FFF6D6",
  onWarningSoft: "#7A4A00",
  error: "#D93025",
  onError: "#FFFFFF",
  errorSoft: "#FCE8E6",
  onErrorSoft: "#B3261E",
  // the four status kinds (src/status.ts)
  good: "#1E8E3E",
  goodSoft: "#E6F4EA",
  waiting: "#B26A00",
  waitingSoft: "#FFF3D1",
  you: "#D93025",
  youSoft: "#FCE8E6",
  none: "#6B6B6B",
  noneSoft: "#EFEFED",
  info: "#4A6B53",
  onInfo: "#FFFFFF",
  border: "#E5E5EA",
  borderStrong: "#C7C7CC",
  divider: "#E5E5EA",
  overlay: "rgba(0,0,0,0.4)",
  shadow: "#000000",
};

export type ThemeColors = typeof light;

const dark: ThemeColors = {
  surface: "#121212",
  onSurface: "#F2F2F2",
  surfaceSecondary: "#1C1C1E",
  onSurfaceSecondary: "#F2F2F2",
  surfaceTertiary: "#2C2C2E",
  onSurfaceTertiary: "#D1D1D6",
  surfaceInverse: "#F2F2F2",
  onSurfaceInverse: "#1C1C1E",
  muted: "#8E8E93",
  brand: "#5E8A6A",
  onBrand: "#121212",
  brandPrimary: "#5E8A6A",
  onBrandPrimary: "#121212",
  brandSecondary: "#2A4031",
  onBrandSecondary: "#CFE3D4",
  brandTertiary: "#1A261D",
  onBrandTertiary: "#CFE3D4",
  success: "#32D74B",
  onSuccess: "#121212",
  successSoft: "#173A20",
  onSuccessSoft: "#7EE495",
  warning: "#FFD60A",
  onWarning: "#121212",
  warningSoft: "#3A3110",
  onWarningSoft: "#FFE27A",
  error: "#FF453A",
  onError: "#121212",
  errorSoft: "#3D1A18",
  onErrorSoft: "#FF9A93",
  good: "#32D74B",
  goodSoft: "#173A20",
  waiting: "#FFD60A",
  waitingSoft: "#3A3110",
  you: "#FF453A",
  youSoft: "#3D1A18",
  none: "#8E8E93",
  noneSoft: "#2C2C2E",
  info: "#5E8A6A",
  onInfo: "#121212",
  border: "#38383A",
  borderStrong: "#48484A",
  divider: "#38383A",
  overlay: "rgba(0,0,0,0.6)",
  shadow: "#000000",
};

export const defaultScheme = "light" satisfies ColorScheme;
export const themes: { light: ThemeColors; dark?: ThemeColors } = { light, dark };

export const fonts = {
  regular: "PJS-400",
  medium: "PJS-500",
  semibold: "PJS-600",
  bold: "PJS-700",
  extrabold: "PJS-800",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}
setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = (system === "light" || system === "dark") && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
