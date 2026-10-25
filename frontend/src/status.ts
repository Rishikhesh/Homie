// One status language for the whole app: every state maps to exactly one of four kinds.
// "you" (red) always means: the person looking needs to act, or it's late.
import { ThemeColors } from "@/src/theme";

export type Kind = "good" | "waiting" | "you" | "none";
export type Role = "tenant" | "landlord" | "handyman";
export type St = { kind: Kind; label: string };

export const KIND_ICON: Record<Kind, string> = { good: "checkmark-circle", waiting: "time", you: "alert-circle", none: "ellipse-outline" };
export const KIND_SPOKEN: Record<Kind, string> = { good: "done", waiting: "in progress", you: "needs you", none: "nothing to do" };
export const kindColor = (c: ThemeColors, k: Kind) => ({ good: c.good, waiting: c.waiting, you: c.you, none: c.none })[k];
export const kindSoft = (c: ThemeColors, k: Kind) => ({ good: c.goodSoft, waiting: c.waitingSoft, you: c.youSoft, none: c.noneSoft })[k];

const DAY = 86400000;
/** "Today", "Tomorrow", "Thu 3 pm", "Nov 1" — never ISO. */
export function when(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / DAY);
  const h = d.getHours(), m = d.getMinutes();
  const time = h || m ? ` ${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}` : "";
  if (days === 0) return `Today${time}`;
  if (days === 1) return `Tomorrow${time}`;
  if (days > 1 && days < 7) return `${d.toLocaleDateString("en-US", { weekday: "short" })}${time}`;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}${time}`;
}
/** Visit times use the server's label (already in the property's time zone); iso only when there's no label. */
export const slotLabel = (s?: { iso?: string; label?: string } | null) => (s ? s.label || (s.iso ? when(s.iso) : "") : "");

function ticket(t: any, role: Role): St {
  const s = t.status;
  const slot = slotLabel(t.picked_slot);
  if (role === "landlord" && t.pending_approval && !["closed", "cancelled"].includes(s)) return { kind: "you", label: "Needs your OK" };
  switch (s) {
    case "reported":
    case "finding_handyman": return { kind: "waiting", label: "Finding a handyman" };
    case "offered": return role === "handyman" ? { kind: "you", label: "New job" } : { kind: "waiting", label: "Handyman asked" };
    case "awaiting_tenant_time":
      if (role === "tenant") return slot ? { kind: "waiting", label: `Picked ${slot}` } : { kind: "you", label: "Pick a time" };
      return { kind: "waiting", label: slot ? "Waiting for OK" : "Waiting on a time" };
    case "booked": return { kind: "waiting", label: `Booked ${slot}`.trim() };
    case "fixed_pending_confirm": return role === "tenant" ? { kind: "you", label: "Is it fixed?" } : { kind: "waiting", label: "Tenant checking" };
    case "payment_pending_approval":
      if (role === "landlord") return { kind: "you", label: "Needs your OK" };
      return role === "handyman" ? { kind: "waiting", label: "Payment on the way" } : { kind: "good", label: "Fixed" };
    case "closed": return { kind: "good", label: role === "handyman" ? "Paid" : "Fixed" };
    case "self_fix_limit_pending":
    case "receipt_submitted":
    case "reimbursement_pending_approval":
      return role === "landlord" ? { kind: "you", label: "Needs your OK" } : { kind: "waiting", label: "Waiting for owner" };
    case "self_fix_approved": return role === "tenant" ? { kind: "you", label: "Send receipt" } : { kind: "waiting", label: "Tenant fixing it" };
    case "needs_landlord": return role === "landlord" ? { kind: "you", label: "Needs you" } : { kind: "waiting", label: "Owner on it" };
    case "cancelled": return { kind: "none", label: "Closed" };
    default: return { kind: "waiting", label: "In progress" };
  }
}

/** Rent row from the ledger ({status, period}) or next_due. */
function rent(r: any, role: Role): St {
  if (!r) return { kind: "good", label: "Paid" };
  const due = r.due_day && r.period ? new Date(`${r.period}-${String(r.due_day).padStart(2, "0")}T12:00:00`) : null;
  const days = due ? Math.round((due.getTime() - Date.now()) / DAY) : null;
  switch (r.status) {
    case "paid": return { kind: "good", label: "Paid" };
    case "overdue": return { kind: "you", label: days != null && days < 0 ? `Late ${-days} day${days === -1 ? "" : "s"}` : "Late" };
    case "due":
      if (days != null && days < 0) return { kind: role === "tenant" ? "you" : "waiting", label: "Due now" };
      return { kind: "waiting", label: days == null ? "Due" : days === 0 ? "Due today" : `Due in ${days} day${days === 1 ? "" : "s"}` };
    case "upcoming": return { kind: "none", label: "Not due yet" };
    case "vacant": return { kind: "none", label: "Empty" };
    default: return { kind: "none", label: "No rent" };
  }
}

function approval(_a: any, role: Role): St {
  return role === "landlord" ? { kind: "you", label: "Needs your OK" } : { kind: "waiting", label: "Waiting for owner" };
}

function lease(l: any, role: Role): St {
  switch (l?.status) {
    case "signed": return { kind: "good", label: "Signed" };
    case "sent": return role === "tenant" ? { kind: "you", label: "Sign your lease" } : { kind: "waiting", label: "Waiting for tenant" };
    case "tenant_signed": return role === "landlord" ? { kind: "you", label: "Sign your part" } : { kind: "waiting", label: "Waiting for owner" };
    case "draft": return role === "landlord" ? { kind: "you", label: "Finish and send" } : { kind: "waiting", label: "Being prepared" };
    default: return { kind: "none", label: "No lease" };
  }
}

/** Move-in / move-out check (inspection) and the move-out summary (statement). */
function moveout(x: any, role: Role): St {
  const s = x?.status;
  if (x?.kind === "statement") {
    if (s === "confirmed" || s === "sent") return { kind: "good", label: x.refund ? "Refund sent" : "Sent" };
    return role === "landlord" ? { kind: "you", label: "Needs your OK" } : { kind: "waiting", label: "Owner reviewing" };
  }
  switch (s) {
    case "in_progress": return role === "tenant" ? { kind: "you", label: "Record your rooms" } : { kind: "waiting", label: "Tenant recording" };
    case "submitted":
    case "analyzing": return { kind: "waiting", label: "Comparing photos" };
    case "analyzed": return role === "landlord" ? { kind: "you", label: "Needs your OK" } : { kind: "waiting", label: "Owner reviewing" };
    case "approved":
    case "signed": return { kind: "good", label: "Done" };
    default: return { kind: "none", label: "Not started" };
  }
}

function deposit(d: any, _role: Role): St {
  if (d?.refunded) return { kind: "good", label: "Refunded" };
  if (d?.held) return { kind: "none", label: "Held" };
  if (d?.due) return { kind: _role === "tenant" ? "you" : "waiting", label: "Deposit due" };
  return { kind: "none", label: "No deposit" };
}

const step = (s: any): St => (s?.done ? { kind: "good", label: "Done" } : s?.mine ? { kind: "you", label: s.label || "Your turn" } : { kind: "waiting", label: s?.label || "Waiting" });

export type EntityType = "ticket" | "rent" | "approval" | "lease" | "moveout" | "deposit" | "step";
export function statusOf(entity: any, role: Role = "tenant", type: EntityType = "ticket"): St {
  const r = { ticket, rent, approval, lease, moveout, deposit, step: (e: any) => step(e) }[type](entity, role);
  return r;
}
