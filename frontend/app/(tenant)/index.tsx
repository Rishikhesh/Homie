import React, { useState } from "react";
import { Linking, RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { useLive } from "@/src/useLive";
import { useAuth } from "@/src/auth";
import { BigButton, Card, ErrorState, Field, Ionicons, LargeHeader, Row, Screen, Section, Sheet, Skeleton, TextButton, Txt, useToast } from "@/src/ui";
import { BigNumber, DocTile, MOVE_IN_STEPS, MOVE_OUT_STEPS, REPAIR_STEPS, Status, StripCard, Tracker, burst, tradeIcon } from "@/src/visual";
import { statusOf } from "@/src/status";
import { repairCurrent } from "@/src/chatcards";
import { PhotoButtons } from "@/src/inputs";
import { PayButton } from "@/src/pay";
import { spacing, useTheme } from "@/src/theme";

const INSURERS = [{ n: "Lemonade", u: "https://www.lemonade.com/renters" }, { n: "State Farm", u: "https://www.statefarm.com/insurance/home-and-property/renters" }, { n: "Allstate", u: "https://www.allstate.com/renters-insurance" }];
const UTIL_LINKS: any = { "PG&E": "https://www.pge.com", Xfinity: "https://www.xfinity.com" };
const UTIL_ICON: any = { electric: "flash", gas: "flame", internet: "wifi" };

function InspectionCard() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const { data: x, reload } = useLive<any>(() => api("/inspections/mine"), 5000);
  if (!x) return null;
  const mo = x.move_out, mi = x.move_in;
  if (mo) {
    const cur = x.statement ? 5 : mo.status === "in_progress" ? 1 : mo.status === "analyzed" ? 3 : 2;
    const mine = mo.status === "in_progress";
    return (
      <StripCard kind={mine ? "you" : x.statement ? "good" : "waiting"} testID={mine ? "moveout-check-card" : "moveout-status-card"} style={{ marginBottom: spacing.xl, gap: spacing.sm }}
        onPress={mine ? undefined : () => router.push(x.statement ? `/statement/${x.statement.id}` : `/inspection/${mo.id}`)}>
        <Txt v="h2">Moving out</Txt>
        <Tracker steps={MOVE_OUT_STEPS} current={cur} mine={mine} />
        {mine ? <BigButton testID="start-moveout-check" icon="videocam" label="Record your rooms" onPress={() => router.push(`/inspection/${mo.id}`)} />
          : <Status kind={x.statement ? "good" : "waiting"} label={x.statement ? "Summary ready ›" : "Owner reviewing"} size="sm" />}
      </StripCard>
    );
  }
  if (mi?.locked) return null;
  return (
    <StripCard kind="you" testID="movein-check-card" style={{ marginBottom: spacing.xl, gap: spacing.sm }}>
      <Row><Ionicons name="videocam" size={20} color={colors.you} /><Txt v="h2" style={{ flex: 1 }}>Move-in check</Txt></Row>
      <Txt v="body">A short video of each room protects your deposit.</Txt>
      <BigButton testID="start-movein-check" icon="videocam" label={mi ? "Continue check" : "Start check"}
        onPress={async () => { try { const i = mi || await api("/inspections/move-in", { method: "POST" }); reload(); router.push(`/inspection/${i.id}`); } catch (e: any) { toast(e.message, "error"); } }} />
    </StripCard>
  );
}

export default function TenantHome() {
  const { me } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();
  const toast = useToast();
  const { data: d, error, loading, reload } = useLive<any>(() => api("/tenant/home"), 3000);
  const [ins, setIns] = useState(false);
  const [f, setF] = useState<any>({});
  if (loading && !d) return <Screen tab><Skeleton /></Screen>;
  const ob = d?.onboarding;
  const utilsDone = ob && ["electric", "gas", "internet"].every((k) => ob.utilities?.[k]);
  const obDone = ob && ob.lease_signed && ob.insurance?.done && utilsDone;
  const cur = !ob ? 0 : !ob.lease_signed ? 0 : !ob.insurance?.done ? 1 : !utilsDone ? 2 : 4;
  const saveUtil = async (k: string) => { try { await api("/tenant/onboarding", { method: "PATCH", body: { utilities: { [k]: true } } }); burst(); reload(); } catch (e: any) { toast(e.message, "error"); } };
  const rentSt = d?.unit ? statusOf(d.next_due ? { ...d.next_due, due_day: d.unit.due_day } : null, "tenant", "rent") : null;
  const done = <Status kind="good" label="Done" size="sm" />;
  return (
    <Screen tab testID="tenant-home-screen" refresh={<RefreshControl refreshing={false} onRefresh={reload} />}>
      <LargeHeader title={`Hi ${me?.user?.name?.split(" ")[0] || ""} 👋`}
        actions={me?.acting ? [] : [{ label: "Settings", icon: "settings-outline", onPress: () => router.push("/settings"), testID: "tenant-settings-button" }]} />
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {d?.unit && rentSt ? (
        <>
          <StripCard kind={rentSt.kind} testID="rent-card" style={{ marginBottom: spacing.xl, gap: spacing.sm }}>
            <BigNumber testID="rent-amount" value={d.next_due ? d.next_due.remaining : d.unit.rent} caption={d.next_due ? `${d.next_due.month.split(" ")[0]} rent` : "Rent"} />
            <Status testID="rent-status" kind={rentSt.kind} label={rentSt.label} />
            <PayButton due={d.next_due} deposit={d.deposit_due} onPaid={reload} landlord={d.landlord_name.split(" ")[0]} />
          </StripCard>

          <InspectionCard />

          <Section title="Repairs" testID="tenant-open-tickets" right={d.tickets.length ? <TextButton testID="tenant-all-repairs" label="All repairs ›" onPress={() => router.push("/(tenant)/tickets")} /> : undefined}>
            {d.tickets.length ? d.tickets.slice(0, 2).map((t: any, i: number) => {
              const st = statusOf(t, "tenant");
              return (
                <StripCard key={t.id} kind={st.kind} index={i} testID={`ticket-row-${t.id}`} onPress={() => router.push(`/ticket/${t.id}`)} style={{ gap: spacing.sm }}>
                  <Row><Ionicons name={tradeIcon(t.trade) as any} size={20} color={colors.brandPrimary} /><Txt v="label" style={{ flex: 1 }} numberOfLines={1}>{t.title}</Txt></Row>
                  <Tracker steps={REPAIR_STEPS} current={repairCurrent(t)} mine={st.kind === "you"} />
                  <Status testID={`ticket-status-${t.id}`} kind={st.kind} label={st.label} size="sm" />
                </StripCard>
              );
            }) : (
              <Card testID="tenant-tickets-empty" style={{ gap: spacing.md }}>
                <Status kind="none" label="No repairs" />
                <BigButton testID="tenant-tickets-empty-action" icon="camera" label="Report a problem" onPress={() => router.push("/(tenant)/chat")} />
              </Card>
            )}
          </Section>

          <Section title={obDone ? "My home" : "Moving in"} testID={obDone ? "lease-card-section" : "onboarding-section"}>
            {!obDone ? (
              <Card style={{ gap: spacing.md }}>
                <Tracker steps={MOVE_IN_STEPS} current={cur} mine />
                <Row testID="onboarding-lease" style={{ justifyContent: "space-between", minHeight: 48 }}>
                  <Row style={{ flex: 1 }}><Ionicons name="document-text" size={22} color={colors.brandPrimary} /><Txt v="label">Lease</Txt></Row>
                  {ob.lease_signed ? done : d.lease ? <TextButton testID="onboarding-open-lease" label={d.lease.status === "tenant_signed" ? "Waiting for owner" : "Sign ›"} onPress={() => router.push(`/lease/${d.lease.id}`)} /> : <Status kind="waiting" label="Being prepared" size="sm" />}
                </Row>
                <Row testID="onboarding-insurance" style={{ justifyContent: "space-between", minHeight: 48 }}>
                  <Row style={{ flex: 1 }}><Ionicons name="shield-checkmark" size={22} color={colors.brandPrimary} /><Txt v="label">Insurance</Txt></Row>
                  {ob.insurance?.done ? done : <TextButton testID="onboarding-insurance-open" label="Add ›" onPress={() => setIns(true)} />}
                </Row>
                <View testID="onboarding-utilities">
                  {["electric", "gas", "internet"].map((k) => {
                    const prov = d.property.utilities?.[k] || "Ask owner";
                    return (
                      <Row key={k} style={{ justifyContent: "space-between", minHeight: 48 }}>
                        <Row style={{ flex: 1 }}><Ionicons name={UTIL_ICON[k]} size={22} color={colors.brandPrimary} />
                          <Txt v="label" onPress={UTIL_LINKS[prov] ? () => Linking.openURL(UTIL_LINKS[prov]) : undefined}>{k[0].toUpperCase() + k.slice(1)} · {prov}</Txt></Row>
                        {ob.utilities?.[k] ? done : <TextButton testID={`utility-done-${k}`} label="Mark done" onPress={() => saveUtil(k)} />}
                      </Row>
                    );
                  })}
                </View>
              </Card>
            ) : null}
            {d.lease?.status === "signed" ? (
              <View testID="lease-card" style={{ gap: spacing.sm }}>
                <DocTile testID="lease-view-button" name="Lease" onView={() => router.push(`/lease/${d.lease.id}`)} />
                {ob?.insurance?.done ? <DocTile name={`Insurance · ${ob.insurance.provider}`} icon="shield-checkmark" onView={() => setIns(true)} /> : null}
                <Row style={{ flexWrap: "wrap" }}>
                  <TextButton testID="lease-ask-button" icon="sparkles" label="Ask about lease" onPress={() => router.push({ pathname: "/(tenant)/chat", params: { q: "Ask about my lease" } } as any)} />
                  <TextButton testID="lease-rights-button" icon="shield-checkmark-outline" label="Your rights ›" onPress={() => router.push(`/rights?state=${d.property.state}`)} />
                </Row>
              </View>
            ) : null}
          </Section>
        </>
      ) : null}

      <Sheet visible={ins} onClose={() => setIns(false)} title="Renters insurance" testID="insurance-sheet">
        <View style={{ gap: spacing.md }}>
          <Txt v="body">Get a price, then add your policy.</Txt>
          {INSURERS.map((x, i) => <TextButton key={x.n} testID={`insurer-link-${i}`} icon="open-outline" label={x.n} onPress={() => Linking.openURL(x.u)} />)}
          <Field testID="insurance-provider-input" label="Provider" value={f.provider || ""} onChangeText={(v) => setF({ ...f, provider: v })} />
          <Field testID="insurance-policy-input" label="Policy number" value={f.policy_no || ""} onChangeText={(v) => setF({ ...f, policy_no: v })} />
          <PhotoButtons testID="insurance-proof" label="Or upload proof" onUploaded={(id) => setF({ ...f, proof_id: id })} />
          {f.proof_id ? <Status kind="good" label="Proof added" size="sm" /> : null}
          <BigButton testID="insurance-save" label="Save" disabled={!f.provider || !(f.policy_no || f.proof_id)} onPress={async () => { try { await api("/tenant/onboarding", { method: "PATCH", body: { insurance: f } }); burst("Saved"); setIns(false); reload(); } catch (e: any) { toast(e.message, "error"); } }} />
        </View>
      </Sheet>
    </Screen>
  );
}
