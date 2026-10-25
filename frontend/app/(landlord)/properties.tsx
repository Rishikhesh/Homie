import React from "react";
import { RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { api, money, propertyPhoto } from "@/src/api";
import { useLive } from "@/src/useLive";
import { EmptyState, ErrorState, LargeHeader, PhotoCard, Screen, Skeleton } from "@/src/ui";
import { spacing } from "@/src/theme";

export default function Properties() {
  const router = useRouter();
  const { data, error, loading, reload } = useLive<any[]>(() => api("/properties"), 0);
  return (
    <Screen tab testID="properties-screen" refresh={<RefreshControl refreshing={false} onRefresh={reload} />}>
      <LargeHeader title="Properties" subtitle="Your homes and rooms" actions={[{ label: "Add", icon: "add", onPress: () => router.push("/property/new"), testID: "add-property-button" }]} />
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading && !data ? <Skeleton height={170} count={2} /> : (
        <View style={{ gap: spacing.md }}>
          {(data || []).map((p, i) => (
            <PhotoCard key={p.id} index={i} testID={`property-card-${p.id}`} uri={propertyPhoto(p.photo, p.id)} title={p.name}
              subtitle={`${p.units_rented}/${p.units_total} rented · ${money(p.rent_total)}/mo`} onPress={() => router.push(`/property/${p.id}`)} />
          ))}
          {data && !data.length ? <EmptyState testID="properties-empty" icon="home-outline" title="No homes yet" body="Add your first home — as a whole home or as rooms with their own rent." action="Add a property" onAction={() => router.push("/property/new")} /> : null}
        </View>
      )}
    </Screen>
  );
}
