import React, { useState } from "react";
import { api, money } from "@/src/api";
import { BigButton, ConfirmSheet, useToast } from "@/src/ui";
import { burst } from "@/src/visual";
import { spacing } from "@/src/theme";

export function PayButton({ due, deposit, onPaid, landlord }: { due: any; deposit?: number | null; onPaid: () => void; landlord: string }) {
  const toast = useToast();
  const [c, setC] = useState<null | "rent" | "deposit">(null);
  const [busy, setBusy] = useState(false);
  const pay = async () => {
    setBusy(true);
    try { await api("/rent/pay", { body: { kind: c } }); burst("Paid"); toast("Paid. Receipt is in Payments"); setC(null); onPaid(); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  return (
    <>
      {due ? <BigButton testID="pay-rent-button" label={`Pay rent ${money(due.remaining)}`} onPress={() => setC("rent")} disabled={busy} /> : null}
      {deposit ? <BigButton testID="pay-deposit-button" tone="soft" label={`Pay deposit ${money(deposit)}`} onPress={() => setC("deposit")} style={{ marginTop: spacing.sm }} disabled={busy} /> : null}
      <ConfirmSheet visible={!!c} onClose={() => setC(null)} testID="pay-confirm"
        title={c === "deposit" ? `Pay your deposit to ${landlord}?` : `Pay ${landlord} for ${due?.month?.split(" ")[0]}?`} amount={c === "deposit" ? deposit : due?.remaining}
        body="Simulated payment — no real money moves." confirmLabel="Pay now" onConfirm={pay} loading={busy} />
    </>
  );
}
