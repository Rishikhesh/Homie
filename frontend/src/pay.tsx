import React, { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { api, money } from "@/src/api";
import { BigButton, ConfirmSheet, Txt, useToast } from "@/src/ui";
import { burst } from "@/src/visual";
import { useBank } from "@/src/bank";
import { spacing } from "@/src/theme";

/** One tap pays rent. With a connected bank it's a Plaid transfer (sandbox) tenant → landlord; otherwise the simulated payment. */
export function PayButton({ due, deposit, onPaid, landlord }: { due: any; deposit?: number | null; onPaid: () => void; landlord: string }) {
  const toast = useToast();
  const bank = useBank();
  const [c, setC] = useState<null | "rent" | "deposit">(null);
  const [busy, setBusy] = useState(false);
  const viaBank = !!bank.data?.connected;
  const blocked = viaBank && bank.data?.landlord_connected === false; // landlord has no payout bank yet
  const { reload } = bank;
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  const pay = async () => {
    setBusy(true);
    try {
      const r = await api("/rent/pay", { body: { kind: c, method: viaBank ? "bank" : "sim" } });
      burst("Paid");
      toast(r.transfer ? (r.transfer.status === "paid_out" ? `Sent from ${r.transfer.from} to ${landlord}` : "Paid. Your landlord gets it shortly") : "Paid. Receipt is in Payments");
      setC(null); onPaid();
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  const ask = (k: "rent" | "deposit") => { bank.reload(); setC(k); };
  const from = viaBank ? ` from ••${bank.data.mask}` : "";
  return (
    <>
      {due ? <BigButton testID="pay-rent-button" icon={viaBank ? "flash" : undefined} label={`Pay rent ${money(due.remaining)}${from}`} onPress={() => ask("rent")} disabled={busy || blocked} /> : null}
      {deposit ? <BigButton testID="pay-deposit-button" tone="soft" label={`Pay deposit ${money(deposit)}`} onPress={() => ask("deposit")} style={{ marginTop: spacing.sm }} disabled={busy || blocked} /> : null}
      {blocked && (due || deposit) ? <Txt testID="pay-landlord-not-ready" v="small" style={{ marginTop: spacing.sm }}>Your landlord hasn’t set up bank payouts yet. We’ll let you know when you can pay.</Txt> : null}
      <ConfirmSheet visible={!!c} onClose={() => setC(null)} testID="pay-confirm"
        title={c === "deposit" ? `Pay your deposit to ${landlord}?` : `Pay ${landlord} for ${due?.month?.split(" ")[0]}?`} amount={c === "deposit" ? deposit : due?.remaining}
        body={viaBank ? `Bank transfer through Plaid from ${bank.data.bank} ••${bank.data.mask}. Test money only.` : "Simulated payment. No real money moves."} confirmLabel="Pay now" onConfirm={pay} loading={busy} />
    </>
  );
}
