import React from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, money } from "@/src/api";
import { useLive } from "@/src/useLive";
import { Avatar, BigButton, Card, Divider, LargeHeader, Row, Screen, Section, Skeleton, Txt, useToast, TextButton } from "@/src/ui";
import { Status } from "@/src/visual";
import { statusOf } from "@/src/status";
import { spacing } from "@/src/theme";

export default function HandymanDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { data: h, reload } = useLive<any>(() => api(`/handymen/${id}`), 0, [id]);
  if (!h) return <Screen><Skeleton /></Screen>;
  return (
    <Screen testID="handyman-detail-screen">
      <LargeHeader title={h.name} subtitle={`${h.trades.join(", ")} · ${h.city}, ${h.state}`} back={() => router.back()} />
      <Card style={{ marginBottom: spacing.xl }}>
        <Row>
          <Avatar name={h.name} size={56} />
          <View style={{ flex: 1 }}>
            <Txt v="label">★ {h.rating_avg?.toFixed?.(1) || "New"} · {h.rating_count || 0} ratings</Txt>
            <Txt v="small">{h.jobs_done || 0} jobs on Homi</Txt>
          </View>
        </Row>
        <Txt v="caption" style={{ marginTop: spacing.md }}>You&apos;ve paid</Txt>
        <Txt v="money" testID="handyman-paid-total">{money(h.paid_total)}</Txt>
        {h.on_my_list ? <Status size="sm" kind="good" label="On your list" /> : <BigButton testID="handyman-add-button" label="Add to my list" onPress={async () => { await api(`/handymen/${id}/add`, { method: "POST" }); toast("Added"); reload(); }} />}
        {h.on_my_list ? <TextButton testID="handyman-remove-button" label="Remove from my list" onPress={async () => { await api(`/handymen/${id}`, { method: "DELETE" }); reload(); }} /> : null}
      </Card>
      <Section title="Jobs for you" testID="handyman-jobs-section">
        <Card>
          {h.jobs.length ? h.jobs.map((j: any, i: number) => (
            <View key={j.id}>{i ? <Divider /> : null}
              <Row style={{ justifyContent: "space-between" }}>
                <View style={{ flex: 1 }}><Txt v="body" onPress={() => router.push(`/ticket/${j.id}`)}>{j.title}</Txt><Txt v="small">{j.date.slice(0, 10)}{j.rating ? ` · ${j.rating}★` : ""}</Txt></View>
                {j.paid ? <Txt v="label">{money(j.paid)}</Txt> : <Status size="sm" {...statusOf(j, "landlord")} />}
              </Row>
            </View>
          )) : <Txt v="small">No jobs together yet.</Txt>}
        </Card>
      </Section>
    </Screen>
  );
}
