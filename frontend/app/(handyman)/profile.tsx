import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { api, money } from "@/src/api";
import { useLive } from "@/src/useLive";
import { useAuth } from "@/src/auth";
import { TRADES, tradeLabel } from "@/src/constants";
import { Avatar, BigButton, Card, Chip, Field, LargeHeader, Row, Screen, Section, Skeleton, TextButton, Txt, useToast } from "@/src/ui";
import { spacing, useTheme } from "@/src/theme";

export default function Profile() {
  const { me, signOut } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const { data, reload } = useLive<any>(() => api("/handyman/profile"), 0);
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (data && !f) setF({ trades: data.trades || [], zip: data.zip || "", phone: data.phone || "", city: data.city, state: data.state }); }, [data, f]);
  if (!data || !f) return <Screen tab><Skeleton /></Screen>;
  const save = async () => {
    try {
      let place = { city: f.city, state: f.state };
      if (f.zip !== data.zip) place = await api(`/zip/${f.zip}`);
      await api("/handyman/setup", { body: { ...f, ...place } }); toast("Profile saved"); reload();
    } catch (e: any) { toast(e.message, "error"); }
  };
  return (
    <Screen tab testID="handyman-profile-screen">
      <LargeHeader title="Profile" />
      <Card style={{ marginBottom: spacing.xl }}>
        <Row>
          <Avatar name={data.name} size={56} uri={me?.user?.picture} />
          <View style={{ flex: 1 }}>
            <Txt v="h2">{data.name}</Txt>
            <Txt v="small">{data.city}, {data.state} · ★ {data.rating_avg ? data.rating_avg.toFixed(1) : "New"} ({data.rating_count || 0})</Txt>
          </View>
        </Row>
        <Txt v="caption" style={{ marginTop: spacing.lg }}>Earnings this month</Txt>
        <Txt v="money" testID="earnings-month">{money(data.earnings_month)}</Txt>
        <Txt v="small">{data.jobs_done || 0} {data.jobs_done === 1 ? "job" : "jobs"} done · {money(data.earnings_total)} all time</Txt>
      </Card>
      <Section title="Trades">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {TRADES.map((t) => <Chip key={t} testID={`profile-trade-${t}`} label={tradeLabel(t)} selected={f.trades.includes(t)} onPress={() => setF({ ...f, trades: f.trades.includes(t) ? f.trades.filter((x: string) => x !== t) : [...f.trades, t] })} />)}
        </View>
      </Section>
      <View style={{ gap: spacing.lg }}>
        <Field testID="profile-zip-input" label="ZIP" keyboardType="number-pad" maxLength={5} value={f.zip} onChangeText={(v) => setF({ ...f, zip: v })} />
        <Field testID="profile-phone-input" label="Phone" keyboardType="phone-pad" value={f.phone} onChangeText={(v) => setF({ ...f, phone: v })} hint="Never shared with tenants" />
        <BigButton testID="profile-save" label="Save profile" onPress={save} />
        {!me?.acting ? <TextButton testID="profile-sign-out" label="Switch account (sign out)" color={colors.error} onPress={signOut} /> : null}
      </View>
    </Screen>
  );
}
