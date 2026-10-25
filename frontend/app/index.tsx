import { View, ActivityIndicator } from "react-native";
import { useTheme } from "@/src/theme";

// The root gate in _layout redirects from here once the session is known.
export default function Index() {
  const { colors } = useTheme();
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}><ActivityIndicator color={colors.brandPrimary} /></View>;
}
