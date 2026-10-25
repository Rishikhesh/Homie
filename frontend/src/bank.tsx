// Bank connection card (Plaid sandbox test bank) for tenants (pay from) and landlords (get paid to).
// Bank status is one shared store, so connecting here instantly updates every Pay button.
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { api } from "@/src/api";
import { BigButton, Card, Ionicons, Row, TextButton, Txt, useToast } from "@/src/ui";
import { Status, burst } from "@/src/visual";
import { spacing, useTheme } from "@/src/theme";

let state: any = null;
const subs = new Set<(v: any) => void>();
export async function refreshBank() {
  try { state = await api("/bank/me"); } catch { state = state || { connected: false }; }
  subs.forEach((f) => f(state));
  return state;
}

export function useBank() {
  const [data, setData] = useState<any>(null); // never flash a previous user's bank
  useEffect(() => {
    subs.add(setData);
    refreshBank();
    return () => { subs.delete(setData); };
  }, []);
  return { data, reload: refreshBank };
}

export function BankCard({ role, testID = "bank-card" }: { role: "tenant" | "landlord"; testID?: string }) {
  const { colors } = useTheme();
  const toast = useToast();
  const { data: b, reload } = useBank();
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setBusy(true);
    try { await api("/bank/connect", { method: "POST" }); burst("Connected"); await reload(); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  if (!b) return null;
  return (
    <Card testID={testID} style={{ gap: spacing.sm }}>
      <Row>
        <Ionicons name="business" size={20} color={colors.brandPrimary} />
        <Txt v="label" style={{ flex: 1 }}>{role === "tenant" ? "Pay from your bank" : "Get rent paid to"}</Txt>
      </Row>
      {b.connected ? (
        <>
          <Status testID={`${testID}-connected`} kind="good" label={`${b.bank} ••${b.mask}`} size="sm" />
          <View style={{ alignSelf: "flex-start" }}>
            <TextButton testID={`${testID}-disconnect`} label="Disconnect" color={colors.you}
              onPress={async () => { try { await api("/bank/disconnect", { method: "POST" }); await reload(); } catch (e: any) { toast(e.message, "error"); } }} />
          </View>
        </>
      ) : (
        <>
          <Txt v="small">Plaid test bank. Test money only, nothing real moves.</Txt>
          <BigButton testID={`${testID}-connect`} icon="link" tone="soft" label="Connect bank" loading={busy} onPress={connect} />
        </>
      )}
    </Card>
  );
}
