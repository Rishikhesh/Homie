"""Typed visual cards for chat. The agent attaches {type, ref_id}; the app renders them from LIVE data fetched here,
so numbers are always right. Ownership is checked the same way for the agent tool and for the app."""
from fastapi import APIRouter, Depends, HTTPException
from core import db, NF, get_user, first
from data import STATE_RULES

router = APIRouter(prefix="/api")
def _month(period):
    """'2026-10' -> 'October 2026' (never show ISO)."""
    import calendar
    try:
        y, m = str(period).split("-")[:2]
        return f"{calendar.month_name[int(m)]} {y}"
    except Exception:  # noqa: BLE001
        return period or ""


CARD_TYPES = ("repair", "rent", "money", "choice_time", "yes_no", "doc", "countdown", "photo_pair", "law")
# legacy card types still stored on older messages
LEGACY = {"ticket": "repair", "slots": "choice_time", "confirm_fix": "yes_no"}


def _deny():
    raise HTTPException(403, "That isn't yours to see")


def _mine(user):
    return {user["id"], user.get("acting_by")} - {None}


async def _ticket(ref, user):
    t = await db.tickets.find_one({"id": ref}, NF)
    if not t or not (_mine(user) & {t["tenant_id"], t["landlord_id"], t.get("handyman_id")}):
        _deny()
    return t


async def resolve_card(ctype, ref, user, question=None):
    """Live data for one card, or 403 if the record isn't the caller's."""
    ctype = LEGACY.get(ctype, ctype)
    if ctype not in CARD_TYPES:
        raise HTTPException(400, "Unknown card")
    me = _mine(user)
    if ctype in ("repair", "choice_time") or (ctype == "yes_no" and ref):
        t = await _ticket(ref, user)
        h = await db.handymen.find_one({"user_id": t["handyman_id"]}, NF) if t.get("handyman_id") else None
        from server import STEP
        return {"type": ctype, "ticket_id": t["id"], "title": t["title"], "trade": t["trade"], "status": t["status"], "step": STEP.get(t["status"], 0),
                "picked_slot": t.get("picked_slot"), "slots": t.get("slots") or [], "question": question or ("fixed" if ctype == "yes_no" else None),
                "handyman": {"name": h["name"], "rating": h.get("rating_avg"), "trade": (h.get("trades") or [None])[0]} if h else None}
    if ctype == "yes_no":
        return {"type": "yes_no", "question": question or ""}
    if ctype in ("rent", "countdown") and not (ref or "").startswith("insp"):
        unit = await db.units.find_one({"id": ref}, NF) if ref else await db.units.find_one({"tenant_id": user["id"]}, NF)
        if ctype == "countdown" and not unit:
            insp = await db.inspections.find_one({"id": ref}, NF)
            if insp:
                return await _countdown_insp(insp, me)
        if not unit or not (me & {unit.get("tenant_id"), unit["landlord_id"]}):
            _deny()
        from money import oldest_unpaid
        due = await oldest_unpaid(unit)
        row = ({**due, "due_day": unit["due_day"]} if due else None)
        return {"type": ctype, "unit_id": unit["id"], "label": unit["label"], "amount": due["remaining"] if due else unit["rent"], "row": row, "rent": unit["rent"], "due_day": unit["due_day"]}
    if ctype == "countdown":
        insp = await db.inspections.find_one({"id": ref}, NF)
        if not insp:
            _deny()
        return await _countdown_insp(insp, me)
    if ctype == "money":
        a = await db.approvals.find_one({"id": ref}, NF)
        if a:
            if a["landlord_id"] not in me and a.get("tenant_id") not in me:
                _deny()
            return {"type": "money", "amount": a["amount"], "what": a["title"], "status": a["status"], "kind": a["kind"], "approval_id": a["id"], "for_landlord": a["landlord_id"] in me}
        c = await db.credits.find_one({"id": ref}, NF)
        if c:
            if not (me & {c.get("tenant_id"), c.get("landlord_id")}):
                _deny()
            return {"type": "money", "amount": abs(c["amount"]), "what": c["reason"][:40], "status": "applied", "kind": "credit" if c["amount"] > 0 else "charge"}
        st = await db.deposit_statements.find_one({"id": ref}, NF)
        if st and me & {st.get("tenant_id"), st.get("landlord_id")}:
            return {"type": "money", "amount": st["refund"], "what": "Deposit back", "status": st["status"], "kind": "refund", "statement_id": st["id"]}
        _deny()
    if ctype == "doc":
        le = await db.leases.find_one({"id": ref}, NF) if ref else await db.leases.find_one({"tenant_id": user["id"], "status": {"$in": ["signed", "sent", "tenant_signed"]}}, NF, sort=[("created_at", -1)])
        if le:
            if not (me & {le.get("tenant_id"), le["landlord_id"]}):
                _deny()
            return {"type": "doc", "name": "Lease", "icon": "document-text", "route": f"/lease/{le['id']}"}
        p = await db.payments.find_one({"id": ref}, NF)
        if p:
            if not (me & {p.get("tenant_id"), p.get("landlord_id")}):
                _deny()
            return {"type": "doc", "name": f"Receipt {_month(p.get('period'))}".strip(), "icon": "receipt", "pdf": f"/receipts/{p['id']}.pdf"}
        st = await db.deposit_statements.find_one({"id": ref}, NF)
        if st and me & {st.get("tenant_id"), st.get("landlord_id")}:
            return {"type": "doc", "name": "Move-out summary", "icon": "document-text", "route": f"/statement/{st['id']}"}
        if ref and not st:  # agent sent a placeholder ref like "lease" → fall back to the caller's own lease
            le = await db.leases.find_one({"tenant_id": user["id"], "status": {"$in": ["signed", "sent", "tenant_signed"]}}, NF, sort=[("created_at", -1)])
            if le:
                return {"type": "doc", "name": "Lease", "icon": "document-text", "route": f"/lease/{le['id']}"}
        _deny()
    if ctype == "photo_pair":
        st = await db.deposit_statements.find_one({"items.id": ref}, NF)
        if not st or not (me & {st.get("tenant_id"), st.get("landlord_id")}):
            _deny()
        it = next(i for i in st["items"] if i.get("id") == ref)
        return {"type": "photo_pair", "title": it.get("title"), "category": it.get("category"), "charge": it.get("charge", 0), "box": it.get("box"),
                "before": it.get("move_in_frame_id"), "after": it.get("move_out_frame_id"), "statement_id": st["id"]}
    if ctype == "law":
        st = (ref or "CA").upper()
        r = STATE_RULES.get(st)
        if not r:
            raise HTTPException(404, "No rules for this state yet")
        topic = question or ""
        key = next((k for k in r if k in topic), None)
        return {"type": "law", "state": st, "name": r["name"], "topic": topic, "answer": r.get(key) if key else None, "rules": {k: v for k, v in r.items() if k not in ("state", "name", "source_url")},
                "source_url": r.get("source_url")}
    _deny()


async def _countdown_insp(insp, me):
    unit = await db.units.find_one({"id": insp["unit_id"]}, NF)
    if not unit or not (me & {insp.get("tenant_id"), unit["landlord_id"]}):
        _deny()
    from datetime import date
    md = insp.get("move_out_date") or ""
    try:
        days = (date.fromisoformat(md[:10]) - date.today()).days
    except ValueError:
        days = 0
    return {"type": "countdown", "days": days, "caption": "Move-out day", "inspection_id": insp["id"]}


@router.get("/cards/{ctype}/{ref}")
async def get_card(ctype: str, ref: str, q: str | None = None, user=Depends(get_user)):
    return await resolve_card(ctype, None if ref == "-" else ref, user, q)


def fit_line(text, limit=12):
    """Agent reply → (one line of ≤ `limit` words, details). Keeps whole sentences; a question is never hidden."""
    import re
    if "911" in (text or "") or len((text or "").split()) <= limit:
        return text, None
    sents = [x for x in re.split(r"(?<=[.!?])\s+", text.strip()) if x]
    if len(sents) < 2:
        s0 = sents[0] if sents else ""
        m = re.search(r",\s(who|which)\s[^,]+,\s", s0)  # drop an aside: "Hank, who fixed your sink, is on it"
        if m:
            short = s0[:m.start()] + " " + s0[m.end():]
            if len(short.split()) <= limit:
                return short, s0[m.start() + 2:m.end() - 2].capitalize() + "."
        m = re.search(r"(,\s(so|but)\s|\sand\s(will|I'll|I will)\s)", s0)
        if m and len(s0[:m.start()].split()) >= 3:
            rest = s0[m.end():].strip()
            return s0[:m.start()].rstrip(",") + ".", (rest[0].upper() + rest[1:]) if rest else None
        return text, None
    q = next((x for x in sents if x.endswith("?")), None)
    keep = []
    for x in sents:
        if len(" ".join(keep + [x]).split()) > limit and keep:
            break
        keep.append(x)
    if q and q not in keep:
        keep = [sents[0], q] if len(f"{sents[0]} {q}".split()) <= limit and sents[0] != q else [q]
    rest = " ".join(x for x in sents if x not in keep).strip()
    return " ".join(keep), rest or None


def shorten(text, limit=20):
    """Agent text over `limit` words: first sentence stays as text, the rest moves to details."""
    import re
    words = (text or "").split()
    if len(words) <= limit:
        return text, None
    parts = re.split(r"(?<=[.!?])\s+", text.strip(), maxsplit=1)
    head = parts[0]
    if len(head.split()) > limit:  # one very long sentence: cut at a comma or at the limit
        cut = re.split(r"(?<=[,;—–:])\s+", head, maxsplit=1)
        head = cut[0] if len(cut[0].split()) <= limit else " ".join(words[:14]) + "…"
    rest = text.strip()[len(head.rstrip("…")):].strip(" ,;—–:")
    return head, rest or None


_ = first
