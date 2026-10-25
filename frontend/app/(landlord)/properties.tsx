import React from "react";
import { RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { useLive } from "@/src/useLive";
import { EmptyState, ErrorState, LargeHeader, Screen, Skeleton } from "@/src/ui";
import { HomeCard } from "@/src/homes";
import { spacing } from "@/src/theme";

export default function Properties() {
  const router = useRouter();
  const { data, error, loading, reload } = useLive<any>(() => api("/money/overview"), 10000);
  const props = data?.properties || [];
  return (
    <Screen tab testID="properties-screen" refresh={<RefreshControl refreshing={false} onRefresh={reload} />}>
      <LargeHeader title="Homes" actions={[{ label: "Add", icon: "add", onPress: () => router.push("/property/new"), testID: "add-property-button" }]} />
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading && !data ? <Skeleton height={190} count={2} /> : (
        <View style={{ gap: spacing.md }}>
          {props.map((p: any) => <HomeCard key={p.property.id} testID={`property-card-${p.property.id}`} p={p.property} units={p.units} onPress={() => router.push(`/property/${p.property.id}`)} />)}
          {data && !props.length ? <EmptyState testID="properties-empty" icon="home-outline" title="No homes yet" action="Add a home" onAction={() => router.push("/property/new")} /> : null}
        </View>
      )}
    </Screen>
  );
}
