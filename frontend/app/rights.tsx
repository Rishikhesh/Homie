import React from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api } from "@/src/api";
import { useLive } from "@/src/useLive";
import { BigButton, Card, LargeHeader, Screen, Skeleton, Txt } from "@/src/ui";
import { spacing } from "@/src/theme";

export default function Rights() {
  const { state } = useLocalSearchParams<{ state: string }>();
  const router = useRouter();
  const { data: r, error } = useLive<any>(() => api(`/state-rules/${state || "CA"}`), 0, [state]);
  if (error) return <Screen><LargeHeader title="Your rights" back={() => router.back()} /><Txt v="body">{error}</Txt></Screen>;
  if (!r) return <Screen><Skeleton /></Screen>;
  const rows = [["Security deposit", r.deposit_limit], ["Deposit returned within", `${r.deposit_return_days} days`], ["Landlord entry", r.entry_notice], ["Late fees", r.late_fee_rule], ["Repair and deduct", r.repair_and_deduct], ["Rent increase notice", r.rent_increase_notice], ["Also", r.notes]];
  return (
    <Screen testID="rights-screen">
      <LargeHeader title={`Your rights in ${r.state}`} subtitle={r.name} back={() => router.back()} />
      {rows.map(([k, v], i) => <Card key={k} index={i} style={{ marginBottom: spacing.md }}><Txt v="label">{k}</Txt><Txt v="body">{v}</Txt></Card>)}
      <Txt v="small" style={{ marginBottom: spacing.lg }}>General info, not legal advice.</Txt>
      <BigButton testID="rights-ask-button" icon="sparkles" label="Ask Rentwise a question" onPress={() => router.push({ pathname: "/(tenant)/chat", params: { q: "My rights" } } as any)} />
    </Screen>
  );
}
