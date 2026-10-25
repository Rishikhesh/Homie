"""Ticket orchestration, matching, approvals. The only place money records are written."""
from datetime import timedelta
from fastapi import HTTPException
from core import (db, NF, uid, iso, now, money, first, fmt_slot, period_of, next_period, month_name,
                  tell_tenant, tell_handyman, activity, timeline, transition, job_thread, post)

GENERAL_COVERS = {"general", "carpentry", "painting", "appliance", "drywall"}
SELF_FIX_LIMITS = {"plumbing": 150, "electrical": 120, "appliance": 150, "hvac": 200, "locksmith": 100, "other": 60, "general": 80}
DIY_SAFE = {"clogged drain": "Try a plunger first, then a drain snake. Avoid chemical cleaners if you plan to plunge.",
            "running toilet": "Lift the tank lid and check the flapper chain; a new flapper is about $8 at any hardware store.",
            "filter": "Turn the system off, slide the old filter out and match the size printed on its edge."}
PAST_STATUSES = ["closed"]


async def ctx(ticket):
    prop = await db.properties.find_one({"id": ticket["property_id"]}, NF)
    unit = await db.units.find_one({"id": ticket["unit_id"]}, NF)
    tenant = await db.users.find_one({"id": ticket["tenant_id"]}, NF)
    landlord = await db.users.find_one({"id": ticket["landlord_id"]}, NF)
    return prop, unit, tenant, landlord


async def get_ticket(tid):
    t = await db.tickets.find_one({"id": tid}, NF)
    if not t:
        raise HTTPException(404, "Ticket not found")
    return t


async def handyman_doc(hid):
    return await db.handymen.find_one({"user_id": hid}, NF)


async def visible_handymen_query(landlord_id, state=None):
    q = {"$or": [{"is_sample": {"$ne": True}}, {"sample_owner_id": landlord_id}]}
    if state:
        q["state"] = state
    return q


def covers(h, trade):
    tr = set(h.get("trades") or [])
    return trade in tr or ("general" in tr and trade in GENERAL_COVERS)


async def find_handyman(ticket):
    prop, unit, _, _ = await ctx(ticket)
    own_ids = [x["handyman_id"] async for x in db.landlord_handymen.find({"landlord_id": ticket["landlord_id"]}, NF)]
    declined = set(ticket.get("declined_by") or [])
    q = await visible_handymen_query(ticket["landlord_id"])
    cands = [h async for h in db.handymen.find(q, NF)]
    out = []
    for h in cands:
        if h["user_id"] in declined or not covers(h, ticket["trade"]):
            continue
        own = h["user_id"] in own_ids
        if not own and h.get("state") != prop.get("state"):
            continue
        past = await db.tickets.count_documents({"unit_id": ticket["unit_id"], "handyman_id": h["user_id"], "status": "closed"})
        out.append(((1 if own else 0), (1 if ticket["trade"] in (h.get("trades") or []) else 0), past,
                    h.get("rating_avg") or 0, h.get("jobs_done") or 0, h))
    out.sort(key=lambda x: x[:5], reverse=True)
    return out[0][-1] if out else None


async def past_work_note(ticket, hid):
    p = await db.tickets.find_one({"unit_id": ticket["unit_id"], "handyman_id": hid, "status": "closed"}, NF, sort=[("created_at", -1)])
    if p:
        return f", who fixed the {p['title'].lower()} here in {month_name(p['created_at'][:7])}"
    return ""


async def start_matching(ticket, after_decline_of=None):
    ticket = await transition(ticket["id"], ["reported", "offered", "awaiting_tenant_time", "finding_handyman"], "finding_handyman",
                              {"handyman_id": None, "quote": None, "quote_status": None, "slots": []})
    h = await find_handyman(ticket)
    if not h:
        await activity(ticket["landlord_id"], f"No handyman available for “{ticket['title']}” — offered self-fix", ticket["id"])
        return await start_self_fix(ticket, reason="none")
    return await offer_job(ticket, h, after_decline_of)


async def offer_job(ticket, h, after_decline_of=None):
    prop, unit, tenant, _ = await ctx(ticket)
    ticket = await transition(ticket["id"], "finding_handyman", "offered", {"handyman_id": h["user_id"], "offered_at": iso(), "nudged": {}})
    jt = await job_thread(ticket, h["user_id"])
    await db.tickets.update_one({"id": ticket["id"]}, {"$set": {"job_thread_id": jt["id"]}})
    facts = [f["text"] async for f in db.memory_facts.find({"scope": "tenant", "scope_id": ticket["tenant_id"]}, NF)]
    urgent = "URGENT — " if ticket["urgency"] == "emergency" else ""
    brief = (f"{urgent}Hi {first(h['name'])}, new job in {prop['city']}: {ticket['title']}. {ticket['description']}"
             + (f" Good to know: {'; '.join(facts)}." if facts else "")
             + " Tap Accept to send a quote and 2–3 times, or Decline if you can't take it.")
    await post(jt["id"], brief, cards=[{"type": "offer", "ticket_id": ticket["id"]}], attachments=ticket.get("photos") or [])
    note = await past_work_note(ticket, h["user_id"])
    await timeline(ticket["id"], f"Asked {h['name']} to take the job")
    await activity(ticket["landlord_id"], f"Asked {first(h['name'])} to fix the {ticket['title'].lower()}", ticket["id"])
    if after_decline_of:
        await tell_tenant(ticket, f"{first(after_decline_of)} can't make it, so I've asked {h['name']}{note} instead. I'll update you shortly.")
    else:
        await tell_tenant(ticket, f"I've asked {h['name']}{note}. I'll update you shortly.")
    return f"Offered the job to {h['name']}{note}."


async def handyman_accept(ticket, hid, quote, slots):
    if ticket.get("handyman_id") != hid:
        raise HTTPException(403, "This job isn't offered to you")
    prop, _, _, _ = await ctx(ticket)
    tz = prop["timezone"]
    slot_objs = [{"iso": s, "label": fmt_slot(s, tz)} for s in (localize(x, tz) for x in slots[:3])]
    pref = ticket.get("picked_slot")
    ticket = await transition(ticket["id"], "offered", "awaiting_tenant_time",
                              {"quote": float(quote), "quote_status": "pending", "slots": slot_objs, "proposed_at": iso(), "picked_slot": None})
    h = await handyman_doc(hid)
    await create_approval(ticket["landlord_id"], "quote", quote, ticket_id=ticket["id"], tenant_id=ticket["tenant_id"],
                          title=f"Approve {money(quote)} for {ticket['title'].lower()}",
                          reason=f"{h['name']} quoted {money(quote)} to fix the {ticket['title'].lower()} at {prop['name']}.",
                          recommendation=fair_note(ticket["trade"], quote), urgent=ticket["urgency"] == "emergency")
    await timeline(ticket["id"], f"{h['name']} accepted and quoted {money(quote)}")
    await activity(ticket["landlord_id"], f"{first(h['name'])} quoted {money(quote)} for the {ticket['title'].lower()}", ticket["id"])
    labels = " or ".join(s["label"] for s in slot_objs)
    extra = f" (you mentioned {pref['label']} earlier)" if pref else ""
    await tell_tenant(ticket, f"{h['name']} can come {labels}{extra}. Which works for you?", cards=[{"type": "slots", "ticket_id": ticket["id"]}])
    await tell_handyman(ticket, "Thanks! I've sent your times to the tenant and your quote to the owner. I'll confirm the visit here.")


def localize(s, tz):
    """Naive wall-clock times from the handyman's picker are in the property's time zone."""
    from datetime import datetime, timezone
    from zoneinfo import ZoneInfo
    d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if d.tzinfo is None:
        d = d.replace(tzinfo=ZoneInfo(tz))
    return d.astimezone(timezone.utc).isoformat()


def fair_note(trade, amount):
    typical = {"plumbing": (120, 250), "electrical": (120, 300), "hvac": (150, 400), "appliance": (100, 250)}.get(trade, (80, 200))
    if amount <= typical[1]:
        return f"✦ Fair for {trade} in your area (usually {money(typical[0])}–{money(typical[1])}). I recommend approving."
    return f"✦ On the high side for {trade} (usually {money(typical[0])}–{money(typical[1])}). You could ask for a lower price."


async def handyman_decline(ticket, hid, reason="expired"):
    if ticket.get("handyman_id") != hid:
        raise HTTPException(403, "This job isn't offered to you")
    h = await handyman_doc(hid)
    await db.tickets.update_one({"id": ticket["id"]}, {"$addToSet": {"declined_by": hid}, "$push": {"missed": {"hid": hid, "reason": reason, "at": iso()}}})
    word = "didn't reply in time" if reason == "expired" else "declined"
    await timeline(ticket["id"], f"{h['name']} {word}")
    await activity(ticket["landlord_id"], f"{first(h['name'])} {word} — finding the next handyman", ticket["id"])
    if reason == "expired":
        await tell_handyman(ticket, "No reply, so I've passed this job to someone else. No worries — I'll send the next one your way.", handyman_id=hid)
    else:
        await tell_handyman(ticket, "No problem, thanks for letting me know quickly.", handyman_id=hid)
    t = await get_ticket(ticket["id"])
    return await start_matching(t, after_decline_of=h["name"])


async def pick_slot(ticket, slot_iso):
    slot = next((s for s in ticket.get("slots") or [] if s["iso"] == slot_iso), None)
    if not slot:
        raise HTTPException(400, "Please pick one of the offered times")
    ticket = await transition(ticket["id"], "awaiting_tenant_time", "awaiting_tenant_time", {"picked_slot": slot})
    await timeline(ticket["id"], f"Tenant picked {slot['label']}", "tenant")
    _, _, tenant, _ = await ctx(ticket)
    await activity(ticket["landlord_id"], f"{first(tenant['name'])} picked {slot['label']}", ticket["id"])
    booked = await maybe_book(ticket)
    if not booked:
        await tell_tenant(ticket, f"Got it — {slot['label']}. I'll confirm the visit as soon as the cost is approved.")
    return booked


async def maybe_book(ticket):
    if not (ticket.get("picked_slot") and ticket.get("quote_status") == "approved"):
        return False
    slot = ticket["picked_slot"]
    try:
        ticket = await transition(ticket["id"], "awaiting_tenant_time", "booked", {"scheduled_for": slot["iso"]})
    except HTTPException:
        return False
    prop, unit, tenant, _ = await ctx(ticket)
    h = await handyman_doc(ticket["handyman_id"])
    facts = [f["text"] async for f in db.memory_facts.find({"scope": {"$in": ["tenant", "property"]}, "scope_id": {"$in": [ticket["tenant_id"], ticket["property_id"]]}}, NF)]
    heads = f" Heads up: {'; '.join(facts)}." if facts else ""
    access = f" Access: {unit.get('access_notes')}." if unit.get("access_notes") else ""
    await tell_handyman(ticket, f"Booked: {slot['label']} at {prop['address']}, {prop['city']} ({unit['label']}).{heads}{access} Tap Mark fixed when you're done.")
    await tell_tenant(ticket, f"You're booked: {h['name']} will come {slot['label']}. Please clear the area so he can get to it.")
    await timeline(ticket["id"], f"Visit booked for {slot['label']}")
    await activity(ticket["landlord_id"], f"Booked {first(h['name'])} for {slot['label']}", ticket["id"])
    return True


async def mark_fixed(ticket, hid, final_amount, after_photo, receipt=None):
    if ticket.get("handyman_id") != hid:
        raise HTTPException(403, "This job isn't yours")
    if not after_photo:
        raise HTTPException(400, "Please add an after photo")
    await db.files.update_many({"id": {"$in": [x for x in (after_photo, receipt) if x]}, "owner_id": hid}, {"$set": {"ticket_id": ticket["id"]}})
    ticket = await transition(ticket["id"], "booked", "fixed_pending_confirm",
                              {"final_amount": float(final_amount), "after_photos": [after_photo], "receipt_path": receipt, "fixed_at": iso()})
    h = await handyman_doc(hid)
    if float(final_amount) > float(ticket.get("approved_amount") or 0):
        over = float(final_amount) - float(ticket["approved_amount"])
        await create_approval(ticket["landlord_id"], "quote_overage", final_amount, ticket_id=ticket["id"],
                              title=f"{first(h['name'])}'s final price is {money(final_amount)}",
                              reason=f"{money(over)} over the {money(ticket['approved_amount'])} you approved.",
                              recommendation="✦ Ask why before approving, or keep the original amount.")
    await timeline(ticket["id"], f"{h['name']} marked it fixed ({money(final_amount)})", "handyman")
    await activity(ticket["landlord_id"], f"{first(h['name'])} says the {ticket['title'].lower()} is fixed", ticket["id"])
    await tell_tenant(ticket, f"{first(h['name'])} says the {ticket['title'].lower()} is fixed. Is it working now?",
                      cards=[{"type": "confirm_fix", "ticket_id": ticket["id"]}], attachments=[after_photo])
    await tell_handyman(ticket, "Thanks! I've asked the tenant to check it. Payment goes out once they confirm.")


async def confirm_fixed(ticket, ok, note=""):
    h = await handyman_doc(ticket["handyman_id"])
    if ok:
        ticket = await transition(ticket["id"], "fixed_pending_confirm", "payment_pending_approval", {"tenant_confirmed": True})
        amt = min(float(ticket.get("final_amount") or 0), float(ticket.get("approved_amount") or 0)) or float(ticket.get("final_amount") or 0)
        await create_approval(ticket["landlord_id"], "handyman_payment", amt, ticket_id=ticket["id"],
                              title=f"Pay {first(h['name'])} {money(amt)}",
                              reason=f"Tenant confirmed the {ticket['title'].lower()} is fixed. After photo attached.",
                              recommendation="✦ Work confirmed by the tenant. I recommend paying.")
        await timeline(ticket["id"], "Tenant confirmed it's fixed", "tenant")
        await activity(ticket["landlord_id"], f"Tenant confirmed the {ticket['title'].lower()} is fixed", ticket["id"])
        await tell_tenant(ticket, f"Great, glad it's sorted! How did {first(h['name'])} do?", cards=[{"type": "rate", "ticket_id": ticket["id"]}])
        return "Tenant confirmed fixed; payment approval sent to the landlord."
    ticket = await transition(ticket["id"], "fixed_pending_confirm", "booked", {"tenant_confirmed": False})
    await timeline(ticket["id"], f"Tenant says it's not fixed yet{': ' + note if note else ''}", "tenant")
    await activity(ticket["landlord_id"], f"Tenant says the {ticket['title'].lower()} still isn't fixed — reopened", ticket["id"])
    await tell_handyman(ticket, f"The tenant says it's still not working{': ' + note if note else ''}. Could you take another look? Mark fixed again when done.")
    await tell_tenant(ticket, f"Sorry about that. I've asked {first(h['name'])} to come back and look again.")
    return "Reopened; handyman asked to return."


async def rate(ticket, stars):
    if ticket.get("rating"):
        raise HTTPException(409, "Already rated")
    await db.tickets.update_one({"id": ticket["id"]}, {"$set": {"rating": int(stars)}})
    h = await handyman_doc(ticket["handyman_id"])
    n = (h.get("rating_count") or 0) + 1
    avg = ((h.get("rating_avg") or 0) * (n - 1) + int(stars)) / n
    await db.handymen.update_one({"user_id": h["user_id"]}, {"$set": {"rating_avg": round(avg, 2), "rating_count": n}})
    await timeline(ticket["id"], f"Tenant rated {int(stars)}★", "tenant")


# ---------- self-fix ----------
async def start_self_fix(ticket, reason="tenant", limit=None):
    _, _, _, landlord = await ctx(ticket)
    limit = float(limit or SELF_FIX_LIMITS.get(ticket["trade"], 100))
    ticket = await transition(ticket["id"], ["finding_handyman", "offered", "awaiting_tenant_time", "reported"], "self_fix_limit_pending",
                              {"self_fix_limit": limit, "handyman_id": None})
    await create_approval(ticket["landlord_id"], "self_fix_limit", limit, ticket_id=ticket["id"], tenant_id=ticket["tenant_id"],
                          title=f"Approve up to {money(limit)} self-fix",
                          reason=f"{'No handyman is free' if reason == 'none' else 'The tenant prefers their own fixer'} for the {ticket['title'].lower()}. The tenant would get it fixed and get the cost off next rent.",
                          recommendation=f"✦ {money(limit)} is a fair cap for this. No money moves until you see a receipt.")
    await timeline(ticket["id"], f"Self-fix offered (limit {money(limit)} pending approval)")
    lead = "I couldn't find a handyman free for this." if reason == "none" else "Sure, you can use someone you trust."
    await tell_tenant(ticket, f"{lead} You can get it fixed yourself or with someone you trust, and the cost comes off your next rent. "
                              f"I'll check the limit with {first(landlord['name'])} first, so please don't pay anyone yet.")
    return f"Self-fix offered; asked the landlord to approve up to {money(limit)}."


async def submit_receipt(ticket, receipt_id, after_photo, amount, file_hash, read_note=""):
    if not receipt_id or not after_photo:
        raise HTTPException(400, "Please add both the receipt and an after photo")
    if await db.tickets.find_one({"receipt_hash": file_hash, "id": {"$ne": ticket["id"]}}) or await db.used_receipts.find_one({"hash": file_hash}):
        raise HTTPException(409, "This receipt was already used. Please upload the receipt for this repair")
    await db.files.update_many({"id": {"$in": [receipt_id, after_photo]}, "owner_id": ticket["tenant_id"]}, {"$set": {"ticket_id": ticket["id"]}})
    await db.used_receipts.insert_one({"hash": file_hash, "ticket_id": ticket["id"], "at": iso()})
    ticket = await transition(ticket["id"], "self_fix_approved", "reimbursement_pending_approval",
                              {"receipt_path": receipt_id, "receipt_hash": file_hash, "after_photos": [after_photo], "final_amount": float(amount)})
    _, _, tenant, _ = await ctx(ticket)
    limit = float(ticket.get("approved_amount") or 0)
    amt = float(amount)
    over = amt > limit
    await create_approval(ticket["landlord_id"], "reimbursement", amt, ticket_id=ticket["id"], tenant_id=ticket["tenant_id"],
                          title=f"Credit {first(tenant['name'])} {money(min(amt, limit) if over else amt)} off next rent",
                          reason=(f"Receipt {money(amt)}, you approved {money(limit)}." if over else f"Receipt {money(amt)} for the {ticket['title'].lower()}, within your {money(limit)} limit.") + (f" {read_note}" if read_note else ""),
                          recommendation="✦ Receipt and after photo check out." + (" Credit the limit, or approve the full amount." if over else ""),
                          extra={"limit": limit})
    await timeline(ticket["id"], f"Tenant sent a receipt ({money(amt)}) and after photo", "tenant")
    await activity(ticket["landlord_id"], f"{first(tenant['name'])} sent a {money(amt)} receipt for the {ticket['title'].lower()}", ticket["id"])
    await tell_tenant(ticket, "Thanks — I've sent your receipt for approval. I'll tell you as soon as the credit is on your account.")


# ---------- approvals ----------
async def create_approval(landlord_id, kind, amount, ticket_id=None, tenant_id=None, title="", reason="", recommendation="", urgent=False, extra=None):
    a = {"id": uid(), "landlord_id": landlord_id, "kind": kind, "amount": float(amount or 0), "ticket_id": ticket_id, "tenant_id": tenant_id,
         "title": title, "reason": reason, "recommendation": recommendation, "urgent": bool(urgent), "status": "pending",
         "created_at": iso(), "resolved_at": None, **(extra or {})}
    await db.approvals.insert_one(dict(a))
    return a


async def add_expense(landlord_id, property_id, amount, category, description, ticket_id=None, unit_id=None, receipt=None):
    await db.expenses.insert_one({"id": uid(), "landlord_id": landlord_id, "property_id": property_id, "unit_id": unit_id, "ticket_id": ticket_id,
                                  "amount": float(amount), "date": iso(), "category": category, "description": description, "receipt_path": receipt})


async def add_credit(landlord_id, unit_id, tenant_id, amount, reason, approval_id):
    p = next_period(period_of())
    await db.credits.insert_one({"id": uid(), "landlord_id": landlord_id, "unit_id": unit_id, "tenant_id": tenant_id, "period": p,
                                 "amount": float(amount), "reason": reason, "approval_id": approval_id, "created_at": iso()})
    return p


async def decide(landlord_id, approval_id, action, amount=None, option=None):
    a = await db.approvals.find_one_and_update({"id": approval_id, "landlord_id": landlord_id, "status": "pending"},
                                               {"$set": {"status": "approving"}}, projection=NF, return_document=True)
    if not a:
        raise HTTPException(409, "Already handled")
    try:
        if action == "approve":
            amt = float(amount) if amount not in (None, "") else a["amount"]
            await apply_approval(a, amt, option)
            await db.approvals.update_one({"id": a["id"]}, {"$set": {"status": "approved", "amount": amt, "resolved_at": iso()}})
        else:
            await apply_decline(a)
            await db.approvals.update_one({"id": a["id"]}, {"$set": {"status": "declined", "resolved_at": iso()}})
    except Exception:
        await db.approvals.update_one({"id": a["id"]}, {"$set": {"status": "pending"}})
        raise
    return await db.approvals.find_one({"id": a["id"]}, NF)


async def apply_approval(a, amt, option):
    k = a["kind"]
    t = await db.tickets.find_one({"id": a["ticket_id"]}, NF) if a.get("ticket_id") else None
    if k == "quote":
        t = await db.tickets.find_one_and_update({"id": t["id"], "quote_status": "pending"}, {"$set": {"quote_status": "approved", "approved_amount": amt}}, projection=NF, return_document=True)
        if not t:
            raise HTTPException(409, "This quote is no longer pending")
        await timeline(t["id"], f"Owner approved {money(amt)}", "landlord")
        await activity(a["landlord_id"], f"You approved {money(amt)} for the {t['title'].lower()}", t["id"], "landlord")
        if not await maybe_book(t):
            await tell_handyman(t, f"Your {money(amt)} quote is approved. Waiting for the tenant to pick a time.")
    elif k == "quote_overage":
        await db.tickets.update_one({"id": t["id"]}, {"$set": {"approved_amount": amt}})
        await db.approvals.update_one({"ticket_id": t["id"], "kind": "handyman_payment", "status": "pending"}, {"$set": {"amount": amt, "title": f"Pay {money(amt)}"}})
        await timeline(t["id"], f"Owner approved the final price {money(amt)}", "landlord")
    elif k == "handyman_payment":
        t = await transition(t["id"], "payment_pending_approval", "closed", {"paid_amount": amt, "closed_at": iso()})
        h = await handyman_doc(t["handyman_id"])
        await add_expense(a["landlord_id"], t["property_id"], amt, "Repairs", f"{t['title']} — {h['name']}", t["id"], t["unit_id"], t.get("receipt_path"))
        await db.handymen.update_one({"user_id": h["user_id"]}, {"$inc": {"jobs_done": 1, "earnings_total": amt}})
        summary = f"{now().strftime('%b %d')} — {t['title'].lower()}, fixed by {first(h['name'])}, {money(amt)}" + (f", {t['rating']}★" if t.get("rating") else "")
        await db.tickets.update_one({"id": t["id"]}, {"$set": {"summary": summary}})
        await timeline(t["id"], f"Paid {h['name']} {money(amt)} (simulated)", "landlord")
        await activity(a["landlord_id"], f"Paid {first(h['name'])} {money(amt)} — ticket closed", t["id"], "landlord")
        await tell_handyman(t, f"Paid: {money(amt)} for the {t['title'].lower()} (simulated). Thanks for the great work!", cards=[{"type": "receipt", "ticket_id": t["id"]}])
        await tell_tenant(t, f"All done — the {t['title'].lower()} is fixed and paid. Thanks for your patience.", cards=[{"type": "receipt", "ticket_id": t["id"]}])
    elif k == "self_fix_limit":
        t = await transition(t["id"], "self_fix_limit_pending", "self_fix_approved", {"approved_amount": amt, "self_fix_approved_at": iso()})
        diy = next((v for kk, v in DIY_SAFE.items() if kk in (t["title"] + " " + t["description"]).lower()), "")
        await timeline(t["id"], f"Owner approved self-fix up to {money(amt)}", "landlord")
        await activity(a["landlord_id"], f"Self-fix approved up to {money(amt)}", t["id"], "landlord")
        await tell_tenant(t, f"You're approved for up to {money(amt)}. Keep the receipt. When it's fixed, send the receipt and an after photo here or in Tickets." + (f" Quick tip: {diy}" if diy else ""),
                          cards=[{"type": "receipt_request", "ticket_id": t["id"]}])
    elif k == "reimbursement":
        limit = float(a.get("limit") or amt)
        credit = limit if option == "limit" else amt
        t = await transition(t["id"], "reimbursement_pending_approval", "closed", {"paid_amount": credit, "closed_at": iso()})
        p = await add_credit(a["landlord_id"], t["unit_id"], t["tenant_id"], credit, f"Self-fix: {t['title']}", a["id"])
        await add_expense(a["landlord_id"], t["property_id"], credit, "Repairs", f"Self-fix reimbursement — {t['title']}", t["id"], t["unit_id"], t.get("receipt_path"))
        await db.tickets.update_one({"id": t["id"]}, {"$set": {"summary": f"{now().strftime('%b %d')} — {t['title'].lower()}, tenant self-fix, {money(credit)}"}})
        await timeline(t["id"], f"Owner credited {money(credit)} off {month_name(p)} rent", "landlord")
        await activity(a["landlord_id"], f"Credited {money(credit)} off next rent — ticket closed", t["id"], "landlord")
        await tell_tenant(t, f"{money(credit)} will come off your {month_name(p)} rent. Thanks for sorting it!")
    elif k in ("rent_credit", "charge"):
        unit = await db.units.find_one({"tenant_id": a["tenant_id"]}, NF)
        signed = amt if k == "rent_credit" else -amt
        p = await add_credit(a["landlord_id"], unit["id"], a["tenant_id"], signed, a["title"], a["id"])
        t2 = await db.threads.find_one({"kind": "tenant", "tenant_id": a["tenant_id"]}, NF)
        if t2:
            word = "come off" if k == "rent_credit" else "be added to"
            await post(t2["id"], f"{money(amt)} will {word} your {month_name(p)} rent. Reason: {a['reason']}")
        await activity(a["landlord_id"], f"{'Credit' if k == 'rent_credit' else 'Charge'} of {money(amt)} approved", None, "landlord")
    else:
        await activity(a["landlord_id"], f"You handled: {a['title']}", a.get("ticket_id"), "landlord")


async def apply_decline(a):
    k = a["kind"]
    t = await db.tickets.find_one({"id": a["ticket_id"]}, NF) if a.get("ticket_id") else None
    if k == "quote" and t:
        await db.tickets.update_one({"id": t["id"]}, {"$set": {"quote_status": "declined"}, "$addToSet": {"declined_by": t["handyman_id"]}})
        await tell_handyman(t, "Thanks for quoting. The owner has decided to go another way this time — I'll keep you in mind for the next one.")
        await timeline(t["id"], "Owner declined the quote", "landlord")
        await activity(a["landlord_id"], "Quote declined — finding another handyman", t["id"], "landlord")
        t = await get_ticket(t["id"])
        pref = t.get("picked_slot")
        await start_matching(t)
        if pref:
            await db.tickets.update_one({"id": t["id"]}, {"$set": {"picked_slot": pref}})
    elif k == "self_fix_limit" and t:
        await transition(t["id"], "self_fix_limit_pending", "needs_landlord")
        await tell_tenant(t, "The owner will arrange this repair personally. I'll let you know as soon as there's a plan.")
        await activity(a["landlord_id"], "Self-fix declined — you'll arrange this one", t["id"], "landlord")
    elif k == "reimbursement" and t:
        await transition(t["id"], "reimbursement_pending_approval", "needs_landlord")
        await tell_tenant(t, "The owner wants to talk about this receipt before crediting it. I'll update you soon.")
    elif k == "handyman_payment" and t:
        await transition(t["id"], "payment_pending_approval", "needs_landlord")
        await activity(a["landlord_id"], "Payment held — marked as a dispute", t["id"], "landlord")
    elif k == "quote_overage" and t:
        await tell_handyman(t, f"The owner is keeping the approved {money(t.get('approved_amount'))}. Thanks for understanding.")


# ---------- scheduler ----------
async def tick():
    from datetime import datetime
    lock = await db.locks.find_one_and_update({"key": "scheduler", "expires_at": {"$lt": iso()}}, {"$set": {"expires_at": iso(now() + timedelta(seconds=30))}}, upsert=False)
    if lock is None:
        if await db.locks.count_documents({"key": "scheduler"}) == 0:
            await db.locks.insert_one({"key": "scheduler", "expires_at": iso(now() + timedelta(seconds=30))})
        else:
            return
    from core import DEMO, FOLLOWUP
    S = FOLLOWUP if DEMO else None
    cut = lambda normal: iso(now() - timedelta(seconds=S if S else normal))  # noqa: E731
    async for t in db.tickets.find({"status": "offered", "offered_at": {"$lt": cut(7200)}}, NF):
        try:
            await handyman_decline(t, t["handyman_id"], "expired")
        except Exception as e:  # noqa: BLE001
            print("expire fail", e)
    async for t in db.tickets.find({"status": "awaiting_tenant_time", "picked_slot": None, "proposed_at": {"$lt": cut(14400)}, "nudged.time": {"$ne": True}}, NF):
        await db.tickets.update_one({"id": t["id"]}, {"$set": {"nudged.time": True}})
        await tell_tenant(t, "Quick reminder — please pick a time for the visit so I can lock it in.", cards=[{"type": "slots", "ticket_id": t["id"]}])
        await activity(t["landlord_id"], "Nudged the tenant to pick a time", t["id"])
    async for t in db.tickets.find({"status": "booked", "scheduled_for": {"$lt": iso(now() - timedelta(seconds=int(S * 1.5) if S else 10800))}, "nudged.status": {"$ne": True}}, NF):
        await db.tickets.update_one({"id": t["id"]}, {"$set": {"nudged.status": True}})
        await tell_handyman(t, "How did the visit go? Tap Mark fixed with the final price and an after photo when it's done.")
        await activity(t["landlord_id"], "Asked the handyman for a status update", t["id"])
    async for t in db.tickets.find({"status": "self_fix_approved", "self_fix_approved_at": {"$lt": cut(259200)}, "nudged.receipt": {"$ne": True}}, NF):
        await db.tickets.update_one({"id": t["id"]}, {"$set": {"nudged.receipt": True}})
        await tell_tenant(t, "Any luck getting it fixed? Send the receipt and an after photo when it's done.", cards=[{"type": "receipt_request", "ticket_id": t["id"]}])
    _ = datetime
