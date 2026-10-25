import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { api, money } from "@/src/api";
import { AgentMark, BigButton, Card, Field, Ionicons, Row, Sheet, Skeleton, StatusPill, TextButton, Txt, useToast } from "@/src/ui";
import { spacing, useTheme } from "@/src/theme";

const ICON: any = { risk: "alert-circle", opportunity: "bulb", good: "checkmark-circle" };

/** AI money insights for one property's year: short, ranked, each with a $ impact and a one-tap action. */
export function ReportInsights({ propertyId, year, onChanged }: { propertyId: string; year: number; onChanged: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [exp, setExp] = useState<null | { category: string }>(null);
  const [amt, setAmt] = useState("");
  const [desc, setDesc] = useState("");
  const tone: any = {
    risk: [colors.errorSoft, colors.onErrorSoft], opportunity: [colors.warningSoft, colors.onWarningSoft], good: [colors.successSoft, colors.onSuccessSoft],
  };
  const run = async () => {
    setBusy(true);
    try { setData(await api(`/reports/${propertyId}/check?year=${year}`, { method: "POST" })); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  const doAction = (i: any) => {
    const a: string = i.action || "none";
    if (a.startsWith("add_expense")) { setExp({ category: i.action_meta?.category || a.split(":")[1] || "Other" }); return; }
    if (a === "invite_tenant") return router.push(`/property/${propertyId}`);
    if (a === "review_rent") return router.push("/(landlord)/money");
    if (a === "open_tickets") return router.push("/(landlord)/tickets");
  };
  const label = (a?: string) => (a?.startsWith("add_expense") ? `Add ${(a.split(":")[1] || "expense").toLowerCase()}` : { invite_tenant: "Invite a tenant", review_rent: "Review rent", open_tickets: "See repairs" }[a || ""]);
  const total = (data?.insights || []).filter((i: any) => i.tone === "risk" && i.impact).reduce((s: number, i: any) => s + i.impact, 0);

  if (!data) {
    return (
      <Card agent testID="report-insights-cta" style={{ gap: spacing.sm, marginBottom: spacing.xl }}>
        <AgentMark />
        <Txt v="label" style={{ fontSize: 17 }}>Find money you&apos;re missing</Txt>
        <Txt v="small">Rentwise checks vacancies, late rent, missed deductions and repair spend.</Txt>
        {busy ? <Skeleton height={70} count={2} /> : <BigButton testID="report-check-button" icon="sparkles" label="Get insights" onPress={run} />}
      </Card>
    );
  }
  return (
    <View testID="report-insights" style={{ gap: spacing.md, marginBottom: spacing.xl }}>
      <Card agent>
        <AgentMark />
        <Txt v="h2" style={{ marginTop: 4 }} testID="report-insights-headline">{data.headline}</Txt>
        <Row style={{ marginTop: spacing.sm, gap: spacing.xl }}>
          {total ? <View><Txt v="caption">At risk</Txt><Txt v="money" style={{ fontSize: 22 }} color={colors.error}>{money(total)}</Txt></View> : null}
          <View><Txt v="caption">Net</Txt><Txt v="money" style={{ fontSize: 22 }}>{money(data.net)}</Txt></View>
          {data.margin != null ? <View><Txt v="caption">Margin</Txt><Txt v="money" style={{ fontSize: 22 }}>{data.margin}%</Txt></View> : null}
        </Row>
      </Card>
      {data.insights.map((i: any, k: number) => {
        const [bg, fg] = tone[i.tone] || tone.opportunity;
        const l = label(i.action);
        return (
          <Card key={k} index={k} testID={`insight-${k}`}>
            <Row style={{ alignItems: "flex-start" }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}><Ionicons name={ICON[i.tone] || "bulb"} size={20} color={fg} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <Row style={{ justifyContent: "space-between" }}>
                  <Txt v="label" style={{ flex: 1 }}>{i.title}</Txt>
                  {i.impact ? <StatusPill label={money(i.impact)} tone={i.tone === "good" ? "success" : i.tone === "risk" ? "error" : "warning"} /> : null}
                </Row>
                <Txt v="small">{i.detail}</Txt>
                {l ? <View style={{ alignSelf: "flex-start" }}><TextButton testID={`insight-action-${k}`} label={`${l} ›`} onPress={() => doAction(i)} /></View> : null}
              </View>
            </Row>
          </Card>
        );
      })}
      <Row style={{ justifyContent: "space-between" }}>
        <Txt v="small">{data.note}</Txt>
        <TextButton testID="report-insights-refresh" icon="refresh" label="Re-check" onPress={run} disabled={busy} />
      </Row>
      <Sheet visible={!!exp} onClose={() => setExp(null)} title={`Add ${exp?.category.toLowerCase()}`} testID="insight-expense-sheet">
        <View style={{ gap: spacing.md }}>
          <Field testID="insight-expense-amount" label="Amount for the year ($)" keyboardType="decimal-pad" value={amt} onChangeText={setAmt} />
          <Field testID="insight-expense-desc" label="Note" placeholder={exp?.category === "Insurance" ? "Landlord policy" : "Optional"} value={desc} onChangeText={setDesc} />
          <BigButton testID="insight-expense-save" label="Save expense" disabled={!Number(amt)} onPress={async () => {
            try {
              await api("/money/expenses", { body: { property_id: propertyId, category: exp!.category, amount: Number(amt), description: desc || exp!.category, date: `${year}-12-31T12:00:00+00:00` } });
              toast("Expense added"); setExp(null); setAmt(""); setDesc(""); onChanged(); run();
            } catch (e: any) { toast(e.message, "error"); }
          }} />
        </View>
      </Sheet>
    </View>
  );
}
