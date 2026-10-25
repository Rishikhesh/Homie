"""Plaid Transfer (Sandbox): tenants and landlords connect a bank; one tap moves rent tenant → landlord.
Two legs, as Plaid requires: ACH debit from the tenant into the Plaid Ledger, then ACH credit from the Ledger to the landlord.
Sandbox only: test banks and test money; settlement is simulated right away so the books update instantly."""
import json
from fastapi import APIRouter, Depends, HTTPException
from core import db, NF, iso, uid, get_user, activity
from plaid_bank import plaid

router = APIRouter(prefix="/api/bank")
TEST_BANK = "ins_109508"  # Plaid sandbox "First Platypus Bank"
TEST_ACCOUNT = {"override_accounts": [{"type": "depository", "subtype": "checking", "starting_balance": 25000,
                                       "meta": {"name": "Plaid Checking", "mask": "0000"},
                                       "numbers": {"account": "1111222233330000", "ach_routing": "011401533"}}]}


def public(link):
    return {"connected": True, "bank": link["bank"], "mask": link["mask"], "name": link["name"]} if link else {"connected": False}


@router.get("/me")
async def my_bank(user=Depends(get_user)):
    return public(await db.bank_links.find_one({"user_id": user["id"]}, NF))


@router.post("/connect")
async def connect(user=Depends(get_user)):
    """Connect the Plaid sandbox test bank (Auth + Transfer). Access tokens never leave the server."""
    if user["role"] not in ("tenant", "landlord"):
        raise HTTPException(403, "Only tenants and landlords connect a bank here")
    # Default sandbox checking has only $100 available, so rent would be declined NSF; use a custom sandbox user with a real-looking balance.
    pt = await plaid("/sandbox/public_token/create", {"institution_id": TEST_BANK, "initial_products": ["auth", "transfer"],
                                                      "options": {"override_username": "user_custom", "override_password": json.dumps(TEST_ACCOUNT)}})
    ex = await plaid("/item/public_token/exchange", {"public_token": pt["public_token"]})
    acc = await plaid("/auth/get", {"access_token": ex["access_token"]})
    a = next((x for x in acc["accounts"] if x.get("subtype") == "checking"), acc["accounts"][0])
    link = {"user_id": user["id"], "role": user["role"], "item_id": ex["item_id"], "access_token": ex["access_token"], "account_id": a["account_id"],
            "mask": a.get("mask") or "0000", "name": a.get("name") or "Checking", "bank": "First Platypus Bank (test)", "created_at": iso()}
    await db.bank_links.update_one({"user_id": user["id"]}, {"$set": link}, upsert=True)
    if user["role"] == "landlord":
        await activity(user["id"], f"Payout bank connected: {link['bank']} ••{link['mask']}", None, "money")
    return public(link)


@router.post("/disconnect")
async def disconnect(user=Depends(get_user)):
    link = await db.bank_links.find_one_and_delete({"user_id": user["id"]})
    if link:
        try:
            await plaid("/item/remove", {"access_token": link["access_token"]})
        except HTTPException:
            pass  # already gone on Plaid's side
    return {"connected": False}


async def _auth_and_create(link, kind, amount, legal_name, key, desc):
    amt = f"{amount:.2f}"
    au = await plaid("/transfer/authorization/create", {"access_token": link["access_token"], "account_id": link["account_id"], "type": kind, "network": "ach",
                                                        "amount": amt, "ach_class": "web" if kind == "debit" else "ppd", "user": {"legal_name": legal_name},
                                                        "idempotency_key": key[:50]})
    a = au["authorization"]
    if a["decision"] != "approved":
        why = (a.get("decision_rationale") or {}).get("code") or "declined"
        raise HTTPException(402, "Your bank said no: not enough money" if why == "NSF" else f"The bank declined this payment ({why.lower()})")
    t = await plaid("/transfer/create", {"access_token": link["access_token"], "account_id": link["account_id"], "authorization_id": a["id"], "amount": amt, "description": desc[:15]})
    return t["transfer"]


async def charge(tenant, unit, amount, key, kind="rent"):
    """Tenant → Ledger (debit), simulate settle, Ledger → landlord (credit). Returns the transfer record."""
    t_link = await db.bank_links.find_one({"user_id": tenant["id"]}, NF)
    if not t_link:
        raise HTTPException(409, "Connect your bank first")
    l_link = await db.bank_links.find_one({"user_id": unit["landlord_id"]}, NF)
    if not l_link:
        raise HTTPException(409, "Your landlord hasn't connected a bank for payouts yet")
    owner = await db.users.find_one({"id": unit["landlord_id"]}, NF)
    # retry after a crash between "money moved" and "payment recorded": reuse the transfer, never charge twice
    prev = await db.transfers.find_one({"key": key, "payment_id": None, "status": {"$in": ["debited", "paid_out", "payout_pending"]}}, NF)
    if prev:
        return {**prev, "to": f"{l_link['bank']} ••{l_link['mask']}", "from": f"{t_link['bank']} ••{t_link['mask']}"}
    # an attempt that crashed mid-debit (never got a Plaid id) is dead: mark it so it doesn't linger
    await db.transfers.update_many({"key": key, "status": "started", "debit_id": None}, {"$set": {"status": "failed", "error": "interrupted"}})
    rec = {"id": uid(), "key": key, "tenant_id": tenant["id"], "landlord_id": unit["landlord_id"], "unit_id": unit["id"], "amount": float(amount), "kind": kind,
           "debit_id": None, "credit_id": None, "status": "started", "category": kind, "created_at": iso()}
    await db.transfers.insert_one(dict(rec))
    try:
        debit = await _auth_and_create(t_link, "debit", amount, tenant["name"], f"d-{rec['id']}", "Rent")  # one key per attempt; a failed attempt never blocks a retry
    except HTTPException as e:
        await db.transfers.update_one({"id": rec["id"]}, {"$set": {"status": "failed", "error": str(e.detail)}})
        raise
    rec.update(debit_id=debit["id"], status="debited")
    try:  # sandbox: money never moves on its own, so settle it now
        for ev in ("posted", "settled", "funds_available"):
            await plaid("/sandbox/transfer/simulate", {"transfer_id": debit["id"], "event_type": ev})
        credit = await _auth_and_create(l_link, "credit", amount, owner["name"], f"c-{rec['id']}", "Rent payout")
        for ev in ("posted", "settled"):
            await plaid("/sandbox/transfer/simulate", {"transfer_id": credit["id"], "event_type": ev})
        rec.update(credit_id=credit["id"], status="paid_out")
    except HTTPException as e:  # the tenant's money is in; payout retries later
        rec.update(status="payout_pending", error=str(e.detail))
    await db.transfers.update_one({"id": rec["id"]}, {"$set": rec})
    rec["to"] = f"{l_link['bank']} ••{l_link['mask']}"
    rec["from"] = f"{t_link['bank']} ••{t_link['mask']}"
    return rec


@router.get("/transfers")
async def my_transfers(user=Depends(get_user)):
    q = {"tenant_id": user["id"]} if user["role"] == "tenant" else {"landlord_id": user["id"]}
    return [t async for t in db.transfers.find(q, NF).sort("created_at", -1).limit(50)]
