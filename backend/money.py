"""Rent ledger, simulated payments and bank feed, expenses, year-end report."""
import asyncio, csv, io
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pymongo.errors import DuplicateKeyError
from core import db, NF, uid, iso, now, get_user, get_media_user, need, period_of, next_period, month_name, money, first, tenant_thread, post, activity, DEMO
from data import pdf_bytes

router = APIRouter(prefix="/api")


def periods_between(a, b):
    out, p = [], a
    while p <= b:
        out.append(p)
        p = next_period(p)
    return out


async def unit_ledger(unit):
    if not unit.get("tenant_id") or not unit.get("active_from"):
        return []
    cur = period_of()
    tid = unit["tenant_id"]
    pays = [p async for p in db.payments.find({"unit_id": unit["id"], "tenant_id": tid, "kind": "rent", "status": "recorded"}, NF)]
    creds = [c async for c in db.credits.find({"unit_id": unit["id"], "tenant_id": tid}, NF)]
    last = max([cur] + [c["period"] for c in creds])
    rows = []
    for p in periods_between(unit["active_from"], last):
        c = sum(x["amount"] for x in creds if x["period"] == p)
        due = max(0.0, unit["rent"] - c)
        paid = sum(x["amount"] for x in pays if x["period"] == p)
        rem = round(max(0.0, due - paid), 2)
        day = now().day
        if rem == 0:
            st = "paid"
        elif p < cur or (p == cur and day > int(unit.get("due_day") or 1) + 4):
            st = "overdue"
        elif p > cur:
            st = "upcoming"
        else:
            st = "due"
        rows.append({"period": p, "month": month_name(p) + " " + p[:4], "rent": unit["rent"], "credits": c, "due": due, "paid": paid, "remaining": rem, "status": st,
                     "payment_ids": [x["id"] for x in pays if x["period"] == p], "credit_reasons": [x["reason"] for x in creds if x["period"] == p]})
    return rows


async def oldest_unpaid(unit):
    for r in await unit_ledger(unit):
        if r["remaining"] > 0 and r["period"] <= period_of():
            return r
    return None


async def deposit_due(unit):
    lease = await db.leases.find_one({"unit_id": unit["id"], "tenant_id": unit.get("tenant_id"), "status": "signed"}, NF)
    if not lease or lease["terms"].get("deposit_paid"):
        return None
    paid = await db.payments.find_one({"unit_id": unit["id"], "tenant_id": unit["tenant_id"], "kind": "deposit", "status": "recorded"})
    return None if paid else float(lease["terms"].get("deposit") or 0) or None


async def record_payment(unit, amount, period, source, kind="rent", bank_txn_id=None):
    pay = {"id": uid(), "unit_id": unit["id"], "tenant_id": unit["tenant_id"], "landlord_id": unit["landlord_id"], "period": period, "kind": kind,
           "amount": float(amount), "date": iso(), "source": source, "bank_txn_id": bank_txn_id, "status": "recorded"}
    await db.payments.insert_one(dict(pay))
    tenant = await db.users.find_one({"id": unit["tenant_id"]}, NF)
    th = await tenant_thread(unit["tenant_id"], unit["landlord_id"])
    what = "Deposit" if kind == "deposit" else f"{month_name(period)} rent"
    await post(th["id"], f"{what} received: {money(amount)}. Thank you! Your receipt is in Payments.", cards=[{"type": "rent", "ref_id": unit["id"]}, {"type": "doc", "ref_id": pay["id"]}])
    await activity(unit["landlord_id"], f"{first(tenant['name'])} paid {money(amount)} ({what.lower()})", None, "money")
    return pay


async def auto_match(txn):
    """Match: sender name equals exactly one tenant AND amount <= remaining for their oldest unpaid month."""
    units = [u async for u in db.units.find({"landlord_id": txn["landlord_id"], "tenant_id": {"$ne": None}}, NF)]
    tids = [u["tenant_id"] for u in units]
    tenants = [t async for t in db.users.find({"id": {"$in": tids}}, NF)]
    sender = (txn["sender_name"] or "").strip().casefold()
    hits = [t for t in tenants if t["name"].strip().casefold() == sender]
    if not hits and txn.get("source") == "plaid":
        # Bank descriptions add words ("TOM CHEN RENT ZELLE"): accept when exactly one tenant's full name appears.
        hits = [t for t in tenants if t["name"].strip().casefold() in sender]
    if len(hits) == 1:
        unit = next(u for u in units if u["tenant_id"] == hits[0]["id"])
        row = await oldest_unpaid(unit)
        if row and txn["amount"] <= row["remaining"] + 0.001:
            got = await db.bank_txns.find_one_and_update({"id": txn["id"], "status": {"$in": ["new", "review"]}}, {"$set": {"status": "matching"}})
            if not got:
                raise HTTPException(409, "Already matched")
            pay = await record_payment(unit, txn["amount"], row["period"], txn.get("source", "bank_sim"), bank_txn_id=txn["id"])
            await db.bank_txns.update_one({"id": txn["id"]}, {"$set": {"status": "matched", "payment_id": pay["id"]}})
            return pay
    await db.bank_txns.update_one({"id": txn["id"], "status": "new"}, {"$set": {"status": "review"}})
    return None


async def tenant_unit(user):
    u = await db.units.find_one({"tenant_id": user["id"]}, NF)
    if not u:
        raise HTTPException(404, "No home linked yet")
    return u


@router.get("/tenant/payments")
async def tenant_payments(user=Depends(get_user)):
    need(user, "tenant")
    unit = await tenant_unit(user)
    ledger = await unit_ledger(unit)
    pays = [p async for p in db.payments.find({"tenant_id": user["id"], "status": "recorded"}, NF).sort("date", -1)]
    creds = [c async for c in db.credits.find({"tenant_id": user["id"]}, NF).sort("created_at", -1)]
    nxt = await oldest_unpaid(unit)
    landlord = await db.users.find_one({"id": unit["landlord_id"]}, NF)
    return {"unit": unit, "ledger": list(reversed(ledger)), "payments": pays, "credits": creds, "next_due": nxt,
            "deposit_due": await deposit_due(unit), "landlord_name": landlord["name"], "payment_details": landlord.get("payment_details", "")}


@router.post("/rent/pay")
async def pay_rent(body: dict, user=Depends(get_user)):
    need(user, "tenant")
    unit = await tenant_unit(user)
    kind = body.get("kind", "rent")
    if kind == "deposit":
        amt = await deposit_due(unit)
        if not amt:
            raise HTTPException(409, "Your deposit is already paid")
        key, period = f"pay:{user['id']}:deposit", period_of()
    else:
        row = await oldest_unpaid(unit)
        if not row:
            raise HTTPException(409, "Nothing is due right now")
        amt, period = row["remaining"], row["period"]
        key = f"pay:{user['id']}:{period}:{len(row['payment_ids'])}"
    lock_until = iso(now() + timedelta(seconds=120))
    try:
        await db.locks.insert_one({"key": key, "expires_at": lock_until})
    except DuplicateKeyError:
        # A lock left by a crashed request expires after 2 minutes; take it over instead of blocking forever.
        if not await db.locks.find_one_and_update({"key": key, "expires_at": {"$lt": iso()}}, {"$set": {"expires_at": lock_until}}):
            raise HTTPException(409, "This payment is already being processed")
    try:
        source, memo, xfer = "app_sim", f"Homi transfer from {user['name']}", None
        if body.get("method") == "bank":  # real Plaid Transfer (sandbox): money moves before we record it
            from transfers import charge
            xfer = await charge(user, unit, float(amt), key, kind)
            source, memo = "plaid_transfer", f"Plaid transfer from {user['name']} · {xfer['from']}"
        txn = {"id": uid(), "landlord_id": unit["landlord_id"], "date": iso(), "amount": float(amt), "sender_name": user["name"],
               "memo": memo, "status": "new", "payment_id": None, "source": source, "category": "deposit" if kind == "deposit" else "rent",
               "transfer_id": xfer["id"] if xfer else None}
        await db.bank_txns.insert_one(dict(txn))
        if kind == "deposit":
            pay = await record_payment(unit, amt, period, "app_sim", "deposit", txn["id"])
            await db.bank_txns.update_one({"id": txn["id"]}, {"$set": {"status": "matched", "payment_id": pay["id"]}})
        else:
            pay = await auto_match(txn)
        if xfer and pay:
            await db.transfers.update_one({"id": xfer["id"]}, {"$set": {"payment_id": pay["id"]}})
            await db.payments.update_one({"id": pay["id"]}, {"$set": {"source": "plaid_transfer", "transfer_id": xfer["id"]}})
    except Exception:
        await db.locks.delete_one({"key": key})
        raise
    return {"ok": True, "payment": pay, "transfer": {k: xfer[k] for k in ("id", "status", "from", "to")} if xfer else None}


@router.get("/receipts/{pid}.pdf")
async def receipt_pdf(pid: str, user=Depends(get_media_user)):
    p = await db.payments.find_one({"id": pid}, NF)
    if not p or user["id"] not in (p["tenant_id"], p["landlord_id"], user.get("acting_by")):
        raise HTTPException(404, "Receipt not found")
    unit = await db.units.find_one({"id": p["unit_id"]}, NF)
    prop = await db.properties.find_one({"id": unit["property_id"]}, NF)
    t = await db.users.find_one({"id": p["tenant_id"]}, NF)
    lines = [f"Received from: {t['name']}", f"Home: {unit['label']}, {prop['address']}, {prop['city']} {prop['state']}",
             f"For: {'Security deposit' if p['kind'] == 'deposit' else month_name(p['period']) + ' ' + p['period'][:4] + ' rent'}",
             f"Amount: {money(p['amount'])}", f"Date: {p['date'][:10]}", f"Reference: {p['id']}"]
    b = await asyncio.to_thread(pdf_bytes, "Rent receipt", lines, "Paid by bank transfer through Plaid (sandbox test money)." if p.get("source") == "plaid_transfer" else "Simulated payment recorded by Homi.")
    return Response(b, media_type="application/pdf", headers={"Content-Disposition": f"inline; filename=receipt-{pid}.pdf"})


# ---------------- landlord money ----------------
@router.get("/money/grid")
async def rent_grid(user=Depends(get_user)):
    """Rooms × last 6 months, each cell one status."""
    need(user, "landlord")
    cur = period_of()
    y, m = int(cur[:4]), int(cur[5:7])
    periods = []
    for _ in range(6):
        periods.insert(0, f"{y:04d}-{m:02d}")
        m -= 1
        if not m:
            y, m = y - 1, 12
    rows = []
    async for p in db.properties.find({"landlord_id": user["id"]}, NF).sort("created_at", 1):
        async for u in db.units.find({"property_id": p["id"]}, NF):
            led = {r["period"]: r for r in await unit_ledger(u)}
            t = await db.users.find_one({"id": u.get("tenant_id")}, NF) if u.get("tenant_id") else None
            rows.append({"unit_id": u["id"], "label": u["label"], "property": p["name"], "tenant": first(t["name"]) if t else None, "due_day": u["due_day"],
                         "cells": [{"period": x, "status": led[x]["status"] if x in led else "vacant", "paid": led[x]["paid"] if x in led else 0,
                                    "due": led[x]["due"] if x in led else 0} for x in periods]})
    return {"periods": [{"period": x, "label": month_name(x)[:3]} for x in periods], "rows": rows}


@router.get("/money/overview")
async def overview(user=Depends(get_user)):
    need(user, "landlord")
    props = [p async for p in db.properties.find({"landlord_id": user["id"]}, NF)]
    cur = period_of()
    out, collected, overdue = [], 0.0, 0.0
    for p in props:
        rows = []
        async for u in db.units.find({"property_id": p["id"]}, NF):
            ledger = await unit_ledger(u)
            r = next((x for x in ledger if x["period"] == cur), None)
            od = sum(x["remaining"] for x in ledger if x["status"] == "overdue")
            t = await db.users.find_one({"id": u.get("tenant_id")}, NF) if u.get("tenant_id") else None
            collected += r["paid"] if r else 0
            overdue += od
            rows.append({"unit": u, "tenant_name": t["name"] if t else None, "month": r, "overdue": od})
        out.append({"property": p, "units": rows})
    exp = [e async for e in db.expenses.find({"landlord_id": user["id"]}, NF).sort("date", -1).limit(50)]
    return {"period": cur, "month": month_name(cur), "properties": out, "collected": collected, "overdue": overdue, "expenses": exp,
            "bank_connected": bool(user.get("bank_connected")), "demo": DEMO}


@router.get("/money/bank")
async def bank(user=Depends(get_user)):
    need(user, "landlord")
    txns = [t async for t in db.bank_txns.find({"landlord_id": user["id"]}, NF).sort("date", -1).limit(60)]
    tenants = []
    async for u in db.units.find({"landlord_id": user["id"], "tenant_id": {"$ne": None}}, NF):
        t = await db.users.find_one({"id": u["tenant_id"]}, NF)
        tenants.append({"tenant_id": t["id"], "name": t["name"], "unit_label": u["label"]})
    return {"connected": bool(user.get("bank_connected")), "bank_name": user.get("bank_name"), "review": [t for t in txns if t["status"] == "review"],
            "feed": [t for t in txns if t["status"] != "review"], "tenants": tenants}


@router.post("/money/bank/simulate")
async def bank_sim(body: dict, user=Depends(get_user)):
    need(user, "landlord")
    if not DEMO:
        raise HTTPException(403, "Simulation is off")
    txn = {"id": uid(), "landlord_id": user["id"], "date": iso(), "amount": float(body["amount"]), "sender_name": body["sender_name"],
           "memo": body.get("memo") or "Simulated deposit", "status": "new", "payment_id": None, "source": "bank_sim"}
    await db.bank_txns.insert_one(dict(txn))
    pay = await auto_match(txn)
    return {"matched": bool(pay)}


@router.post("/money/bank/{tid}/assign")
async def bank_assign(tid: str, body: dict, user=Depends(get_user)):
    need(user, "landlord")
    txn = await db.bank_txns.find_one_and_update({"id": tid, "landlord_id": user["id"], "status": "review"}, {"$set": {"status": "matching"}}, projection=NF)
    if not txn:
        raise HTTPException(409, "Already handled")
    if body.get("not_rent"):
        await db.bank_txns.update_one({"id": tid}, {"$set": {"status": "not_rent"}})
        return {"ok": True}
    unit = await db.units.find_one({"tenant_id": body["tenant_id"], "landlord_id": user["id"]}, NF)
    row = await oldest_unpaid(unit) if unit else None
    if not row:
        await db.bank_txns.update_one({"id": tid}, {"$set": {"status": "review"}})
        raise HTTPException(400, "That tenant has nothing due")
    pay = await record_payment(unit, txn["amount"], row["period"], "bank_sim", bank_txn_id=tid)
    await db.bank_txns.update_one({"id": tid}, {"$set": {"status": "matched", "payment_id": pay["id"]}})
    return {"ok": True}


@router.post("/money/cash")
async def cash(body: dict, user=Depends(get_user)):
    need(user, "landlord")
    unit = await db.units.find_one({"id": body["unit_id"], "landlord_id": user["id"]}, NF)
    if not unit or not unit.get("tenant_id"):
        raise HTTPException(400, "Pick a room with a tenant")
    row = await oldest_unpaid(unit)
    if not row:
        raise HTTPException(409, "Nothing is due for this room")
    amt = min(float(body.get("amount") or row["remaining"]), row["remaining"])
    return await record_payment(unit, amt, row["period"], "manual")


@router.post("/money/expenses")
async def add_exp(body: dict, user=Depends(get_user)):
    need(user, "landlord")
    p = await db.properties.find_one({"id": body["property_id"], "landlord_id": user["id"]})
    if not p:
        raise HTTPException(404, "Property not found")
    e = {"id": uid(), "landlord_id": user["id"], "property_id": body["property_id"], "unit_id": None, "ticket_id": None, "amount": float(body["amount"]),
         "date": body.get("date") or iso(), "category": body.get("category", "Other"), "description": body.get("description", ""), "receipt_path": None}
    await db.expenses.insert_one(dict(e))
    return e


SCHED_E = {"Advertising": 5, "Cleaning and maintenance": 7, "Insurance": 9, "Mortgage interest": 12, "Repairs": 14, "Supplies": 15, "Taxes": 16, "Utilities": 17, "Other": 19}


async def build_report(user_id, pid, year):
    prop = await db.properties.find_one({"id": pid, "landlord_id": user_id}, NF)
    if not prop:
        raise HTTPException(404, "Property not found")
    units = [u async for u in db.units.find({"property_id": pid}, NF)]
    uids = [u["id"] for u in units]
    pays = [p async for p in db.payments.find({"unit_id": {"$in": uids}, "status": "recorded", "date": {"$regex": f"^{year}"}}, NF)]
    kept = sum([float(s.get("kept") or 0) async for s in db.deposit_statements.find({"unit_id": {"$in": uids}, "status": "sent", "sent_at": {"$regex": f"^{year}"}}, NF)])
    rents = sum(p["amount"] for p in pays if p["kind"] == "rent") + kept
    deposits = sum(p["amount"] for p in pays if p["kind"] == "deposit")
    by_unit = [{"label": u["label"], "rent": sum(p["amount"] for p in pays if p["unit_id"] == u["id"] and p["kind"] == "rent")} for u in units]
    exps = [e async for e in db.expenses.find({"property_id": pid, "date": {"$regex": f"^{year}"}}, NF).sort("date", 1)]
    cats = {}
    for e in exps:
        cats[e["category"]] = cats.get(e["category"], 0) + e["amount"]
    lines = [{"category": k, "line": SCHED_E.get(k, 19), "amount": v} for k, v in sorted(cats.items(), key=lambda x: SCHED_E.get(x[0], 19))]
    total_exp = sum(cats.values())
    return {"property": prop, "year": year, "rents_received": rents, "deposit_kept": kept, "by_unit": by_unit, "deposits_excluded": deposits, "expense_lines": lines,
            "expenses": exps, "total_expenses": total_exp, "net": rents - total_exp}


@router.get("/reports/{pid}")
async def report(pid: str, year: int | None = None, user=Depends(get_user)):
    need(user, "landlord")
    return await build_report(user["id"], pid, year or now().year)


@router.get("/reports/{pid}/export")
async def report_export(pid: str, fmt: str = "pdf", year: int | None = None, user=Depends(get_media_user)):
    need(user, "landlord")
    r = await build_report(user["id"], pid, year or now().year)
    if fmt == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["Schedule E line", "Item", "Amount"])
        w.writerow([3, "Rents received", r["rents_received"]])
        for ln in r["expense_lines"]:
            w.writerow([ln["line"], ln["category"], ln["amount"]])
        w.writerow(["", "Total expenses", r["total_expenses"]])
        w.writerow(["", "Net income", r["net"]])
        w.writerow(["", "Security deposits received this year (not income)", r["deposits_excluded"]])
        return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f"inline; filename=schedule-e-{r['year']}.csv"})
    p = r["property"]
    lines = [f"{p['name']} — {p['address']}, {p['city']} {p['state']}", f"Line 3 · Rents received: {money(r['rents_received'])}"]
    lines += [f"  {u['label']}: {money(u['rent'])}" for u in r["by_unit"]]
    if r.get("deposit_kept"):
        lines.append(f"  Deposit kept for damages: {money(r['deposit_kept'])}")
    lines += [f"Line {ln['line']} · {ln['category']}: {money(ln['amount'])}" for ln in r["expense_lines"]]
    lines += [f"Total expenses: {money(r['total_expenses'])}", f"Net: {money(r['net'])}", f"Security deposits received this year (not income, excluded): {money(r['deposits_excluded'])}"]
    b = await asyncio.to_thread(pdf_bytes, f"Schedule E summary {r['year']}", lines, "Prepared by Homi. Not tax advice — check with your tax professional.")
    return Response(b, media_type="application/pdf", headers={"Content-Disposition": "inline; filename=schedule-e.pdf"})


@router.post("/reports/{pid}/check")
async def report_check(pid: str, request: Request, year: int | None = None, user=Depends(get_user)):
    need(user, "landlord")
    import json, re
    from agent import quick
    from core import OPUS
    yr = year or now().year
    r = await build_report(user["id"], pid, yr)
    facts = await report_facts(r, pid, yr)
    base = rule_insights(facts)
    out = await quick(
        "You are a sharp bookkeeper for a small US landlord. From the FACTS, pick the 3-4 insights worth acting on (money lost, missed deductions, risks, wins). "
        'Reply ONLY JSON: {"headline": "<=12 words, the single most useful takeaway", "insights": [{"tone": "risk|opportunity|good", "title": "<=7 words", '
        '"detail": "<=22 words, concrete, with numbers", "impact": <yearly $ number or null>, "action": "<one of the allowed action ids or none>"}]}. '
        "Allowed actions: " + ", ".join(sorted({i["action"] for i in base} | {"none"})) + ". Never invent numbers not in FACTS. No tax advice disclaimers inside items.",
        json.dumps({"facts": facts, "candidate_insights": base}, default=str), model=OPUS)
    m = re.search(r"\{.*\}", out or "", re.S)
    try:
        data = json.loads(m.group(0))
        ins = [i for i in data.get("insights", []) if i.get("title")][:4]
        if not ins:
            raise ValueError
    except Exception:  # noqa: BLE001
        data, ins = {"headline": base[0]["title"] if base else "Books look healthy"}, base[:4]
    acts = {i["action"]: i for i in base}
    for i in ins:
        i["action_meta"] = acts.get(i.get("action"), {}).get("action_meta")
    return {"headline": data.get("headline"), "insights": ins, "net": r["net"], "margin": facts["margin_pct"], "note": "Not tax advice."}


async def report_facts(r, pid, yr):
    cur = period_of()
    last = cur if str(yr) == cur[:4] else f"{yr}-12"
    units = []
    async for u in db.units.find({"property_id": pid}, NF):
        rows = [x for x in await unit_ledger(u) if x["period"].startswith(str(yr)) and x["period"] <= last]
        start = max(f"{yr}-01", (r["property"].get("created_at") or "")[:7] or f"{yr}-01")
        months_in_year = len(periods_between(start, last))
        units.append({"unit_id": u["id"], "label": u["label"], "rent": u["rent"], "tenant": bool(u.get("tenant_id")),
                      "unpaid": sum(x["remaining"] for x in rows), "late_months": len([x for x in rows if x["status"] == "overdue"]),
                      "vacant_months": max(0, months_in_year - len([x for x in rows if x["period"] >= start])) if u.get("tenant_id") else months_in_year})
    repairs = [e for e in r["expenses"] if e["category"] == "Repairs"]
    by_unit = {}
    for e in repairs:
        by_unit[e.get("unit_id")] = by_unit.get(e.get("unit_id"), 0) + e["amount"]
    have = {ln["category"] for ln in r["expense_lines"]}
    rents = r["rents_received"]
    return {"year": yr, "rents_received": rents, "total_expenses": r["total_expenses"], "net": r["net"],
            "margin_pct": round(r["net"] / rents * 100) if rents else None, "units": units, "repairs_total": sum(e["amount"] for e in repairs),
            "repairs_by_unit": {next((u["label"] for u in units if u["unit_id"] == k), "Property"): v for k, v in by_unit.items()},
            "missing_common_deductions": [c for c in ("Insurance", "Taxes", "Mortgage interest", "Utilities") if c not in have],
            "deposits_received_this_year": r["deposits_excluded"]}


def rule_insights(f):
    out = []
    for u in f["units"]:
        if u["vacant_months"] > 0 and not u["tenant"]:
            out.append({"tone": "risk", "title": f"{u['label']} is sitting empty", "detail": f"{u['vacant_months']} months vacant this year at {money(u['rent'])}/mo.",
                        "impact": u["vacant_months"] * u["rent"], "action": "invite_tenant", "action_meta": {"unit_id": u["unit_id"]}})
        if u["unpaid"] > 0:
            out.append({"tone": "risk", "title": f"{money(u['unpaid'])} unpaid in {u['label']}", "detail": f"{u['late_months']} late month(s). Send a reminder or record a cash payment.",
                        "impact": u["unpaid"], "action": "review_rent", "action_meta": {}})
    for c in f["missing_common_deductions"]:
        out.append({"tone": "opportunity", "title": f"No {c.lower()} logged", "detail": f"Most landlords can deduct {c.lower()}. Add it to lower your taxable profit.",
                    "impact": None, "action": f"add_expense:{c}", "action_meta": {"category": c}})
    for lbl, amt in f["repairs_by_unit"].items():
        if f["rents_received"] and amt > 0.1 * f["rents_received"]:
            out.append({"tone": "risk", "title": f"High repair spend in {lbl}", "detail": f"{money(amt)} on repairs — over 10% of rent. Check for a recurring problem.",
                        "impact": amt, "action": "open_tickets", "action_meta": {}})
    if f["margin_pct"] is not None and f["margin_pct"] >= 60:
        out.append({"tone": "good", "title": f"Healthy {f['margin_pct']}% margin", "detail": f"Net {money(f['net'])} on {money(f['rents_received'])} rent.", "impact": None, "action": "none", "action_meta": {}})
    return out
