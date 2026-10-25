"""Plaid (Sandbox) bank feed for landlords: Hosted Link → exchange → /transactions/sync → bank_txns → auto-match."""
import os
from datetime import date, timedelta
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from core import db, NF, iso, get_user, need, DEMO, activity

router = APIRouter(prefix="/api/plaid")
PLAID_ENV = os.environ.get("PLAID_ENV", "sandbox")
PLAID = f"https://{PLAID_ENV}.plaid.com"


def configured():
    return bool(os.environ.get("PLAID_CLIENT_ID") and os.environ.get("PLAID_SECRET"))


async def plaid(path, payload):
    if not configured():
        raise HTTPException(503, "Plaid isn't set up yet. Add your Plaid keys first")
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(PLAID + path, json=payload, headers={"PLAID-CLIENT-ID": os.environ["PLAID_CLIENT_ID"], "PLAID-SECRET": os.environ["PLAID_SECRET"]})
    d = r.json()
    if r.status_code >= 400 or d.get("error_code"):
        print("plaid error", path, d.get("error_code"), d.get("error_message"))
        raise HTTPException(502, f"Bank connection error: {d.get('error_message') or d.get('error_code') or 'try again'}")
    return d


def public_base(request: Request):
    host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    return f"https://{host}"


@router.get("/status")
async def status(user=Depends(get_user)):
    need(user, "landlord")
    items = [{"institution": i.get("institution"), "last_sync": i.get("last_sync"), "dynamic": i.get("dynamic", False)} async for i in db.plaid_items.find({"landlord_id": user["id"]}, NF)]
    return {"configured": configured(), "env": PLAID_ENV, "items": items, "demo": DEMO}


@router.post("/link/start")
async def link_start(request: Request, user=Depends(get_user)):
    need(user, "landlord")
    base = public_base(request)
    r = await plaid("/link/token/create", {
        "client_name": "Doorman", "language": "en", "country_codes": ["US"], "products": ["transactions"],
        "user": {"client_user_id": user["id"]}, "webhook": f"{base}/api/plaid/webhook",
        "hosted_link": {"completion_redirect_uri": f"{base}/api/plaid/complete", "url_lifetime_seconds": 1800},
    })
    await db.plaid_links.insert_one({"link_token": r["link_token"], "landlord_id": user["id"], "status": "created", "processed": [], "created_at": iso()})
    return {"link_token": r["link_token"], "hosted_link_url": r["hosted_link_url"]}


async def finish_public_token(landlord_id, link_token, public_token, institution=None):
    claimed = await db.plaid_links.find_one_and_update({"link_token": link_token, "processed": {"$ne": public_token}}, {"$addToSet": {"processed": public_token}, "$set": {"status": "success"}})
    if not claimed:
        return
    ex = await plaid("/item/public_token/exchange", {"public_token": public_token})
    await db.plaid_items.update_one({"item_id": ex["item_id"]}, {"$set": {"item_id": ex["item_id"], "landlord_id": landlord_id, "access_token": ex["access_token"],
                                                                          "institution": institution or "Sandbox bank", "cursor": None, "created_at": iso()}}, upsert=True)
    await db.users.update_one({"id": landlord_id}, {"$set": {"bank_connected": True, "bank_name": f"{institution or 'Sandbox bank'} (Plaid)"}})
    await activity(landlord_id, f"Bank connected through Plaid: {institution or 'Sandbox bank'}", None, "money")
    await sync_item(await db.plaid_items.find_one({"item_id": ex["item_id"]}, NF))


@router.get("/link/status/{link_token}")
async def link_status(link_token: str, user=Depends(get_user)):
    s = await db.plaid_links.find_one({"link_token": link_token, "landlord_id": user["id"]}, NF)
    if not s:
        raise HTTPException(404, "Unknown bank-link session")
    if s["status"] != "success":
        # Webhook fallback: read the finished Hosted Link session directly.
        d = await plaid("/link/token/get", {"link_token": link_token})
        for sess in d.get("link_sessions") or []:
            res = sess.get("results") or {}
            for it in res.get("item_add_results") or []:
                await finish_public_token(user["id"], link_token, it["public_token"], (it.get("institution") or {}).get("name"))
            if sess.get("exit") and not res.get("item_add_results"):
                await db.plaid_links.update_one({"link_token": link_token}, {"$set": {"status": "exit"}})
        s = await db.plaid_links.find_one({"link_token": link_token}, NF)
    return {"status": s["status"]}


@router.post("/webhook")
async def webhook(request: Request):
    body = await request.json()
    if body.get("webhook_type") == "LINK" and body.get("webhook_code") == "SESSION_FINISHED" and body.get("status") == "success":
        s = await db.plaid_links.find_one({"link_token": body.get("link_token")}, NF)
        if s:
            for pt in body.get("public_tokens") or []:
                await finish_public_token(s["landlord_id"], s["link_token"], pt)
    elif body.get("webhook_type") == "TRANSACTIONS" and body.get("webhook_code") == "SYNC_UPDATES_AVAILABLE":
        it = await db.plaid_items.find_one({"item_id": body.get("item_id")}, NF)
        if it:
            await sync_item(it)
    return {"ok": True}


@router.get("/complete", response_class=HTMLResponse)
async def complete():
    return """<html><head><meta name=viewport content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,sans-serif;background:#F9F9F8;color:#1C1C1E;padding:40px 24px;text-align:center">
<h2>Bank linked</h2><p>You can close this window and return to Doorman.</p>
<button onclick="window.close()" style="background:#4A6B53;color:#fff;border:0;border-radius:12px;padding:16px 24px;font-size:16px">Return to Doorman</button></body></html>"""


async def sync_item(item):
    """Cursor-based sync. Deposits (Plaid amount < 0) become bank_txns keyed by transaction_id, then auto-match."""
    from money import auto_match
    cursor, pages = item.get("cursor"), []
    initial = cursor is None
    while True:
        p = await plaid("/transactions/sync", {"access_token": item["access_token"], "cursor": cursor, "count": 500})
        pages.append(p)
        cursor = p["next_cursor"]
        if not p["has_more"]:
            break
    new = 0
    for p in pages:
        for t in p.get("added", []) + p.get("modified", []):
            if t.get("amount", 0) >= 0 or t.get("pending"):
                continue
            tid = f"plaid:{t['transaction_id']}"
            if await db.bank_txns.find_one({"id": tid}):
                continue
            txn = {"id": tid, "landlord_id": item["landlord_id"], "date": f"{t.get('date')}T00:00:00+00:00", "amount": round(-t["amount"], 2),
                   "sender_name": t.get("merchant_name") or t.get("name") or "Deposit", "memo": t.get("name") or "", "status": "new", "payment_id": None, "source": "plaid"}
            txn["category"] = await categorize(txn)
            try:
                await db.bank_txns.insert_one(dict(txn))
            except Exception:  # noqa: BLE001 — unique id: already imported
                continue
            new += 1
            pay = await auto_match(txn)
            if not pay and (initial or not await looks_like_rent(txn)):
                # First sync pulls months of history: keep unmatched old deposits out of "Needs review".
                await db.bank_txns.update_one({"id": tid, "status": "review"}, {"$set": {"status": "history"}})
        for rid in p.get("removed", []):
            await db.bank_txns.delete_one({"id": f"plaid:{rid.get('transaction_id') if isinstance(rid, dict) else rid}", "status": {"$ne": "matched"}})
    await db.plaid_items.update_one({"item_id": item["item_id"]}, {"$set": {"cursor": cursor, "last_sync": iso()}})
    return new


async def categorize(txn):
    """Sort an incoming deposit: rent · deposit · fee · other."""
    import re
    desc = (txn.get("sender_name", "") + " " + txn.get("memo", "")).casefold()
    if re.search(r"\bdeposit\b|security", desc):
        return "deposit"
    if re.search(r"late|fee|pet|parking|laundry|key", desc):
        return "fee"
    async for u in db.units.find({"landlord_id": txn["landlord_id"]}, NF):
        if abs(u["rent"] - txn["amount"]) < 0.01:
            return "rent"
        le = await db.leases.find_one({"unit_id": u["id"]}, NF)
        if le and abs(float((le.get("terms") or {}).get("deposit") or 0) - txn["amount"]) < 0.01:
            return "deposit"
    if re.search(r"rent", desc) or await looks_like_rent(txn):
        return "rent"
    return "fee" if txn["amount"] < 100 else "other"


async def looks_like_rent(txn):
    """Only rent-like deposits go to Needs review: a tenant's name in the description, or an amount equal to a room's rent."""
    desc = (txn["sender_name"] + " " + txn.get("memo", "")).casefold()
    async for u in db.units.find({"landlord_id": txn["landlord_id"], "tenant_id": {"$ne": None}}, NF):
        t = await db.users.find_one({"id": u["tenant_id"]}, NF)
        if (t and t["name"].casefold() in desc) or abs(u["rent"] - txn["amount"]) < 0.01:
            return True
    return False


@router.post("/sync")
async def sync_now(user=Depends(get_user)):
    need(user, "landlord")
    n = 0
    async for it in db.plaid_items.find({"landlord_id": user["id"]}, NF):
        n += await sync_item(it)
    return {"imported": n}


@router.post("/sandbox/deposit")
async def sandbox_deposit(body: dict, user=Depends(get_user)):
    """Sandbox only: create a real Plaid Sandbox deposit (needs the bank linked with user_transactions_dynamic)."""
    need(user, "landlord")
    if PLAID_ENV != "sandbox":
        raise HTTPException(403, "Only available in Sandbox")
    it = await db.plaid_items.find_one({"landlord_id": user["id"]}, NF, sort=[("created_at", -1)])
    if not it:
        raise HTTPException(400, "Link a bank with Plaid first")
    try:
        amount = float(body.get("amount"))
        assert amount > 0
    except Exception:  # noqa: BLE001
        raise HTTPException(422, "Enter an amount above $0")
    today = date.today().isoformat()
    await plaid("/sandbox/transactions/create", {"access_token": it["access_token"], "transactions": [
        {"amount": -amount, "date_posted": today, "date_transacted": (date.today() - timedelta(days=0)).isoformat(), "description": body.get("sender_name") or "Deposit"}]})
    await plaid("/transactions/refresh", {"access_token": it["access_token"]})
    return {"ok": True, "note": "Plaid is processing it — tap Sync now in a few seconds"}
