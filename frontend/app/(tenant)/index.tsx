import React, { useState } from "react";
import { Linking, RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { api, money } from "@/src/api";
import { useLive } from "@/src/useLive";
import { useAuth } from "@/src/auth";
import { TicketRow } from "@/src/cards";
import { BigButton, Card, ErrorState, Field, Ionicons, LargeHeader, Row, Screen, Section, Sheet, Skeleton, StatusPill, TextButton, Txt, useToast, EmptyState } from "@/src/ui";
import { PhotoButtons } from "@/src/inputs";
import { PayButton } from "@/src/pay";
import { spacing, useTheme } from "@/src/theme";

const INSURERS = [{ n: "Lemonade", u: "https://www.lemonade.com/renters" }, { n: "State Farm", u: "https://www.statefarm.com/insurance/home-and-property/renters" }, { n: "Allstate", u: "https://www.allstate.com/renters-insurance" }];
const UTIL_LINKS: any = { "PG&E": "https://www.pge.com", Xfinity: "https://www.xfinity.com" };

function InspectionCard() {
  const router = useRouter();
  const toast = useToast();
  const { data: x, reload } = useLive<any>(() => api("/inspections/mine"), 5000);
  if (!x) return null;
  const mo = x.move_out, mi = x.move_in;
  if (mo && mo.status === "in_progress") {
    return (
      <Card agent testID="moveout-check-card" style={{ marginBottom: spacing.xl, gap: spacing.sm }}>
        <Txt v="label" style={{ fontSize: 17 }}>Move-out check</Txt>
        <Txt v="body">Moving out {mo.move_out_date}. Walk through each room once more so your deposit comes back fast.</Txt>
        <BigButton testID="start-moveout-check" icon="videocam" label="Do your move-out check" style={{ minHeight: 56 }} onPress={() => router.push(`/inspection/${mo.id}`)} />
      </Card>
    );
  }
  if (mo) return <Card testID="moveout-status-card" style={{ marginBottom: spacing.xl }} onPress={() => router.push(`/inspection/${mo.id}`)}><Txt v="label">Move-out check sent</Txt><Txt v="small">{x.statement ? "Your statement is in Payments" : "Your landlord is reviewing it"}</Txt></Card>;
  if (mi?.locked) return null;
  return (
    <Card agent testID="movein-check-card" style={{ marginBottom: spacing.xl, gap: spacing.sm }}>
      <Txt v="label" style={{ fontSize: 17 }}>Move-in check</Txt>
      <Txt v="body">{mi ? "Finish your move-in check — it records how the home looked, so you're never charged for what was already there." : "Do your move-in check now. A short video of each room protects your deposit."}</Txt>
      <BigButton testID="start-movein-check" icon="videocam" label={mi ? "Continue move-in check" : "Do your move-in check now"} style={{ minHeight: 56 }}
        onPress={async () => { try { const i = mi || await api("/inspections/move-in", { method: "POST" }); reload(); router.push(`/inspection/${i.id}`); } catch (e: any) { toast(e.message, "error"); } }} />
    </Card>
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
  const steps = ob ? [ob.lease_signed, ob.insurance?.done, utilsDone].filter(Boolean).length : 0;
  const saveUtil = async (k: string) => { try { await api("/tenant/onboarding", { method: "PATCH", body: { utilities: { [k]: true } } }); reload(); } catch (e: any) { toast(e.message, "error"); } };
  return (
    <Screen tab testID="tenant-home-screen" refresh={<RefreshControl refreshing={false} onRefresh={reload} />}>
      <LargeHeader title={`Hi ${me?.user?.name?.split(" ")[0] || ""}`} subtitle={d?.unit ? `${d.unit.label} · ${d.property.name}` : undefined}
        actions={me?.acting ? [] : [{ label: "Settings", icon: "settings-outline", onPress: () => router.push("/settings"), testID: "tenant-settings-button" }]} />
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {d?.unit ? (
        <>
          <Card testID="rent-card" style={{ marginBottom: spacing.xl }}>
            <Txt v="caption">{d.next_due ? `${d.next_due.month} rent` : "Rent"}</Txt>
            <Txt v="money" testID="rent-amount">{money(d.next_due ? d.next_due.remaining : d.unit.rent)}</Txt>
            <Row style={{ marginBottom: spacing.md }}>
              <StatusPill testID="rent-status" label={d.next_due ? (d.next_due.status === "overdue" ? "Overdue" : `Due on the ${d.unit.due_day}${d.unit.due_day === 1 ? "st" : "th"}`) : "All paid"} tone={d.next_due ? (d.next_due.status === "overdue" ? "error" : "warning") : "success"} />
              {d.next_due?.credits ? <Txt v="small">Includes {money(d.next_due.credits)} credit</Txt> : null}
            </Row>
            <PayButton due={d.next_due} deposit={d.deposit_due} onPaid={reload} landlord={d.landlord_name.split(" ")[0]} />
          </Card>

          {!obDone ? (
            <Section title={`Get set up · ${steps}/3`} testID="onboarding-section">
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceTertiary }}><View style={{ height: 6, borderRadius: 3, width: `${(steps / 3) * 100}%`, backgroundColor: colors.brandPrimary }} /></View>
              <Card testID="onboarding-lease">
                <Row style={{ justifyContent: "space-between" }}>
                  <Txt v="label">1. Sign your lease</Txt>
                  {ob.lease_signed ? <StatusPill label="Done" tone="success" /> : d.lease ? <TextButton testID="onboarding-open-lease" label={d.lease.status === "tenant_signed" ? "Waiting for owner" : "Read & sign ›"} onPress={() => router.push(`/lease/${d.lease.id}`)} /> : <Txt v="small">Your landlord is preparing it</Txt>}
                </Row>
              </Card>
              <Card testID="onboarding-insurance">
                <Row style={{ justifyContent: "space-between" }}>
                  <Txt v="label">2. Renters insurance</Txt>
                  {ob.insurance?.done ? <StatusPill label="Done" tone="success" /> : <TextButton testID="onboarding-insurance-open" label="Add ›" onPress={() => setIns(true)} />}
                </Row>
              </Card>
              <Card testID="onboarding-utilities">
                <Txt v="label" style={{ marginBottom: spacing.sm }}>3. Set up utilities</Txt>
                {["electric", "gas", "internet"].map((k) => {
                  const prov = d.property.utilities?.[k] || "Ask your landlord";
                  return (
                    <Row key={k} style={{ justifyContent: "space-between", minHeight: 44 }}>
                      <Txt v="body" style={{ flex: 1 }} onPress={UTIL_LINKS[prov] ? () => Linking.openURL(UTIL_LINKS[prov]) : undefined}>{k[0].toUpperCase() + k.slice(1)} · <Txt v="body" color={colors.brandPrimary}>{prov}</Txt></Txt>
                      {ob.utilities?.[k] ? <StatusPill label="Done" tone="success" /> : <TextButton testID={`utility-done-${k}`} label="Mark done" onPress={() => saveUtil(k)} />}
                    </Row>
                  );
                })}
              </Card>
            </Section>
          ) : null}

          <InspectionCard />
          <Section title="Your repairs" testID="tenant-open-tickets">
            {d.tickets.length ? d.tickets.map((t: any, i: number) => <TicketRow key={t.id} t={t} role="tenant" index={i} />) : (
              <EmptyState testID="tenant-tickets-empty" icon="construct-outline" title="Nothing broken" body="If something needs fixing, tell Rentwise in Chat — it handles the rest." action="Report a problem" onAction={() => router.push("/(tenant)/chat")} />
            )}
          </Section>

          {d.lease?.status === "signed" ? (
            <Section title="Your lease" testID="lease-card-section">
              <Card testID="lease-card">
                <Txt v="body">{money(d.lease.terms.rent)}/mo · deposit {money(d.lease.terms.deposit)}</Txt>
                <Txt v="small">{d.lease.terms.start} → {d.lease.terms.end} · Pets: {d.lease.terms.pets}</Txt>
                <Row style={{ marginTop: spacing.sm, flexWrap: "wrap" }}>
                  <TextButton testID="lease-ask-button" icon="sparkles" label="Ask about my lease" onPress={() => router.push({ pathname: "/(tenant)/chat", params: { q: "Ask about my lease" } } as any)} />
                  <TextButton testID="lease-rights-button" icon="shield-checkmark-outline" label={`Your rights in ${d.property.state}`} onPress={() => router.push(`/rights?state=${d.property.state}`)} />
                  <TextButton testID="lease-view-button" icon="document-text-outline" label="View lease" onPress={() => router.push(`/lease/${d.lease.id}`)} />
                </Row>
              </Card>
            </Section>
          ) : null}
        </>
      ) : null}

      <Sheet visible={ins} onClose={() => setIns(false)} title="Renters insurance" testID="insurance-sheet">
        <View style={{ gap: spacing.md }}>
          <Txt v="body">Get a quote from one of these, then add your policy here.</Txt>
          {INSURERS.map((x, i) => <TextButton key={x.n} testID={`insurer-link-${i}`} icon="open-outline" label={x.n} onPress={() => Linking.openURL(x.u)} />)}
          <Field testID="insurance-provider-input" label="Provider" value={f.provider || ""} onChangeText={(v) => setF({ ...f, provider: v })} />
          <Field testID="insurance-policy-input" label="Policy number" value={f.policy_no || ""} onChangeText={(v) => setF({ ...f, policy_no: v })} />
          <PhotoButtons testID="insurance-proof" label="Or upload proof" onUploaded={(id) => setF({ ...f, proof_id: id })} />
          {f.proof_id ? <Row><Ionicons name="checkmark-circle" size={18} color={colors.success} /><Txt v="small">Proof uploaded</Txt></Row> : null}
          <BigButton testID="insurance-save" label="Save" disabled={!f.provider || !(f.policy_no || f.proof_id)} onPress={async () => { try { await api("/tenant/onboarding", { method: "PATCH", body: { insurance: f } }); toast("Insurance saved"); setIns(false); reload(); } catch (e: any) { toast(e.message, "error"); } }} />
        </View>
      </Sheet>
    </Screen>
  );
}
