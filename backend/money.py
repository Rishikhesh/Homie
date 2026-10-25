"""Rent ledger, simulated payments and bank feed, expenses, year-end report."""
import asyncio, csv, io
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pymongo.errors import DuplicateKeyError
from core import db, NF, uid, iso, now, get_user, need, period_of, next_period, month_name, money, first, tenant_thread, post, activity, DEMO
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
    if not lease:
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
    await post(th["id"], f"{what} received: {money(amount)}. Thank you! Your receipt is in Payments.", cards=[{"type": "payment_receipt", "payment_id": pay["id"]}])
    await activity(unit["landlord_id"], f"{first(tenant['name'])} paid {money(amount)} ({what.lower()})", None, "money")
    return pay


async def auto_match(txn):
    """Match: sender name equals exactly one tenant AND amount <= remaining for their oldest unpaid month."""
    units = [u async for u in db.units.find({"landlord_id": txn["landlord_id"], "tenant_id": {"$ne": None}}, NF)]
    tids = [u["tenant_id"] for u in units]
    tenants = [t async for t in db.users.find({"id": {"$in": tids}}, NF)]
    hits = [t for t in tenants if t["name"].strip().casefold() == (txn["sender_name"] or "").strip().casefold()]
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
    try:
        await db.locks.insert_one({"key": key, "expires_at": iso()})
    except DuplicateKeyError:
        raise HTTPException(409, "This payment is already being processed")
    txn = {"id": uid(), "landlord_id": unit["landlord_id"], "date": iso(), "amount": float(amt), "sender_name": user["name"],
           "memo": f"Rentwise transfer from {user['name']}", "status": "new", "payment_id": None, "source": "app_sim"}
    await db.bank_txns.insert_one(dict(txn))
    if kind == "deposit":
        pay = await record_payment(unit, amt, period, "app_sim", "deposit", txn["id"])
        await db.bank_txns.update_one({"id": txn["id"]}, {"$set": {"status": "matched", "payment_id": pay["id"]}})
    else:
        pay = await auto_match(txn)
    return {"ok": True, "payment": pay}


@router.get("/receipts/{pid}.pdf")
async def receipt_pdf(pid: str, user=Depends(get_user)):
    p = await db.payments.find_one({"id": pid}, NF)
    if not p or user["id"] not in (p["tenant_id"], p["landlord_id"], user.get("acting_by")):
        raise HTTPException(404, "Receipt not found")
    unit = await db.units.find_one({"id": p["unit_id"]}, NF)
    prop = await db.properties.find_one({"id": unit["property_id"]}, NF)
    t = await db.users.find_one({"id": p["tenant_id"]}, NF)
    lines = [f"Received from: {t['name']}", f"Home: {unit['label']}, {prop['address']}, {prop['city']} {prop['state']}",
             f"For: {'Security deposit' if p['kind'] == 'deposit' else month_name(p['period']) + ' ' + p['period'][:4] + ' rent'}",
             f"Amount: {money(p['amount'])}", f"Date: {p['date'][:10]}", f"Reference: {p['id']}"]
    b = await asyncio.to_thread(pdf_bytes, "Rent receipt", lines, "Simulated payment recorded by Rentwise.")
    return Response(b, media_type="application/pdf", headers={"Content-Disposition": f"inline; filename=receipt-{pid}.pdf"})


# ---------------- landlord money ----------------
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


@router.post("/money/bank/connect")
async def bank_connect(body: dict, user=Depends(get_user)):
    need(user, "landlord")
    name = body.get("bank", "Demo Bank") + " ••1234"
    await db.users.update_one({"id": user["id"]}, {"$set": {"bank_connected": True, "bank_name": name}})
    return {"connected": True, "bank_name": name}


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
    rents = sum(p["amount"] for p in pays if p["kind"] == "rent")
    deposits = sum(p["amount"] for p in pays if p["kind"] == "deposit")
    by_unit = [{"label": u["label"], "rent": sum(p["amount"] for p in pays if p["unit_id"] == u["id"] and p["kind"] == "rent")} for u in units]
    exps = [e async for e in db.expenses.find({"property_id": pid, "date": {"$regex": f"^{year}"}}, NF).sort("date", 1)]
    cats = {}
    for e in exps:
        cats[e["category"]] = cats.get(e["category"], 0) + e["amount"]
    lines = [{"category": k, "line": SCHED_E.get(k, 19), "amount": v} for k, v in sorted(cats.items(), key=lambda x: SCHED_E.get(x[0], 19))]
    total_exp = sum(cats.values())
    return {"property": prop, "year": year, "rents_received": rents, "by_unit": by_unit, "deposits_excluded": deposits, "expense_lines": lines,
            "expenses": exps, "total_expenses": total_exp, "net": rents - total_exp}


@router.get("/reports/{pid}")
async def report(pid: str, year: int | None = None, user=Depends(get_user)):
    need(user, "landlord")
    return await build_report(user["id"], pid, year or now().year)


@router.get("/reports/{pid}/export")
async def report_export(pid: str, fmt: str = "pdf", year: int | None = None, user=Depends(get_user)):
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
        w.writerow(["", "Deposits held (not income)", r["deposits_excluded"]])
        return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f"inline; filename=schedule-e-{r['year']}.csv"})
    p = r["property"]
    lines = [f"{p['name']} — {p['address']}, {p['city']} {p['state']}", f"Line 3 · Rents received: {money(r['rents_received'])}"]
    lines += [f"  {u['label']}: {money(u['rent'])}" for u in r["by_unit"]]
    lines += [f"Line {ln['line']} · {ln['category']}: {money(ln['amount'])}" for ln in r["expense_lines"]]
    lines += [f"Total expenses: {money(r['total_expenses'])}", f"Net: {money(r['net'])}", f"Security deposits held (excluded): {money(r['deposits_excluded'])}"]
    b = await asyncio.to_thread(pdf_bytes, f"Schedule E summary {r['year']}", lines, "Prepared by Rentwise. Not tax advice — check with your tax professional.")
    return Response(b, media_type="application/pdf", headers={"Content-Disposition": "inline; filename=schedule-e.pdf"})


@router.post("/reports/{pid}/check")
async def report_check(pid: str, request: Request, year: int | None = None, user=Depends(get_user)):
    need(user, "landlord")
    from agent import quick
    from core import OPUS
    r = await build_report(user["id"], pid, year or now().year)
    slim = {k: v for k, v in r.items() if k not in ("expenses", "property")}
    txt = await quick("You check small-landlord Schedule E summaries. List up to 4 short bullet points of anything odd or missing (e.g. no insurance, months without rent, unusual repair totals). Plain words. End with 'Not tax advice.'",
                      str(slim), model=OPUS)
    return {"notes": txt}
