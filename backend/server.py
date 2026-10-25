import asyncio, hashlib, httpx, io, json, re
from datetime import timedelta
from fastapi import FastAPI, APIRouter, Depends, HTTPException, UploadFile, File, Request
from fastapi.responses import Response
from starlette.middleware.cors import CORSMiddleware
from core import (db, NF, uid, iso, now, get_user, need, DEMO, APP_NAME, period_of, money, first, tz_for, put_object, get_object, init_storage,
                  tenant_thread, landlord_thread, post, activity, log, read_file, OPUS, get_media_user, media_token_for)
import flows
import agent
from data import seed_static, create_sample_home, lease_text, doc_hash, pdf_bytes, STATE_RULES, DEPOSIT_MONTHS
from money import router as money_router, unit_ledger, oldest_unpaid, deposit_due
from plaid_bank import router as plaid_router
from inspections import router as inspections_router, VIDEO_MAX_MB
from voice import router as voice_router

app = FastAPI()
api = APIRouter(prefix="/api")


@app.get("/health", include_in_schema=False)
async def health_root():
    return {"status": "ok"}


@api.get("/health")
async def health():
    return {"status": "ok", "demo": DEMO}


# ---------------- auth ----------------
async def new_session(user_id, token=None, test=False):
    token = token or uid() + uid()
    await db.sessions.update_one({"token": token}, {"$set": {"token": token, "user_id": user_id, "expires_at": now() + timedelta(days=7 if not test else 365), "test": test}}, upsert=True)
    return token


@api.post("/auth/session")
async def auth_session(body: dict):
    sid = body.get("session_id")
    if not sid:
        raise HTTPException(400, "Missing session_id")
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get("https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data", headers={"X-Session-ID": sid})
    if r.status_code != 200:
        raise HTTPException(401, "Sign-in expired. Please try again")
    d = r.json()
    email = d["email"].lower()
    u = await db.users.find_one({"email": email, "is_sample": {"$ne": True}}, NF)
    if not u:
        u = {"id": uid(), "email": email, "name": d.get("name") or email.split("@")[0], "picture": d.get("picture"), "role": None, "is_sample": False, "created_at": iso()}
        await db.users.insert_one(dict(u))
    else:
        await db.users.update_one({"id": u["id"]}, {"$set": {"picture": d.get("picture") or u.get("picture")}})
    token = await new_session(u["id"])
    return {"session_token": token, "user": u}


@api.post("/auth/logout")
async def logout(request: Request):
    h = request.headers.get("Authorization", "")
    if h.startswith("Bearer "):
        await db.sessions.delete_one({"token": h[7:], "test": {"$ne": True}})
    return {"ok": True}


async def pending_invites(user):
    out = []
    async for i in db.invites.find({"email": user["email"].lower(), "status": "pending"}, NF):
        ll = await db.users.find_one({"id": i["landlord_id"]}, NF)
        if i["kind"] == "tenant":
            u = await db.units.find_one({"id": i["unit_id"]}, NF)
            p = await db.properties.find_one({"id": u["property_id"]}, NF) if u else None
            if not p:
                continue
            i["text"] = f"You've been invited to {u['label']} at {p['address']}"
            i["sub"] = f"{p['city']}, {p['state']} · {money(u['rent'])}/mo · from {ll['name']}"
        else:
            i["text"] = f"Join {ll['name']}'s handyman list"
            i["sub"] = "You'll get their repair jobs first"
        out.append(i)
    return out


@api.get("/auth/me")
async def me(request: Request, user=Depends(get_user)):
    res = {"user": user, "acting": bool(user.get("acting_by")), "demo": DEMO,
           "media_token": await media_token_for(request.headers["Authorization"][7:])}
    if user.get("acting_by"):
        res["real_user"] = await db.users.find_one({"id": user["acting_by"]}, NF)
    if user.get("role") == "tenant":
        res["unit"] = await db.units.find_one({"tenant_id": user["id"]}, NF)
    if user.get("role") == "handyman":
        res["handyman"] = await db.handymen.find_one({"user_id": user["id"]}, NF)
    if not user.get("is_sample"):
        res["invites"] = await pending_invites(user)
    return res


@api.post("/auth/role")
async def set_role(body: dict, user=Depends(get_user)):
    role = body.get("role")
    if role not in ("landlord", "tenant", "handyman"):
        raise HTTPException(400, "Pick landlord, tenant or handyman")
    if user.get("role") and user.get("role_changed"):
        raise HTTPException(409, "Role can only be changed once")
    if user.get("role"):
        busy = await db.properties.count_documents({"landlord_id": user["id"], "is_sample": {"$ne": True}}) + await db.units.count_documents({"tenant_id": user["id"]}) + await db.tickets.count_documents({"handyman_id": user["id"]})
        if busy:
            raise HTTPException(409, "This account already has data, so its role can't change")
    await db.users.update_one({"id": user["id"]}, {"$set": {"role": role, "role_changed": bool(user.get("role"))}})
    if role == "landlord" and body.get("start") == "sample":
        await create_sample_home(user["id"])
    return {"ok": True}


# ---------------- invites ----------------
@api.get("/invites/mine")
async def my_invites(user=Depends(get_user)):
    return await pending_invites(user)


@api.post("/invites/{iid}/accept")
async def accept_invite(iid: str, user=Depends(get_user)):
    inv = await db.invites.find_one_and_update({"id": iid, "email": user["email"].lower(), "status": "pending"}, {"$set": {"status": "accepted"}}, projection=NF)
    if not inv:
        raise HTTPException(409, "This invite is no longer available")
    if inv["kind"] == "tenant":
        need(user, "tenant")
        if await db.units.find_one({"tenant_id": user["id"]}):
            raise HTTPException(409, "You're already linked to a home")
        u = await db.units.find_one_and_update({"id": inv["unit_id"], "tenant_id": None}, {"$set": {"tenant_id": user["id"], "active_from": period_of()}}, projection=NF)
        if not u:
            raise HTTPException(409, "This room already has a tenant")
        await db.leases.update_many({"invite_id": iid}, {"$set": {"tenant_id": user["id"]}})
        pre_signed = bool(await db.leases.find_one({"invite_id": iid, "status": "signed"}))
        await db.onboarding.update_one({"tenant_id": user["id"]}, {"$setOnInsert": {"tenant_id": user["id"], "lease_signed": pre_signed, "insurance": {"done": False}, "utilities": {}}}, upsert=True)
        th = await tenant_thread(user["id"], inv["landlord_id"])
        ll = await db.users.find_one({"id": inv["landlord_id"]}, NF)
        await post(th["id"], f"Welcome, {first(user['name'])}! I'm Rentwise — I look after your home for {first(ll['name'])}. Report a problem, ask about rent or your lease any time.")
        await activity(inv["landlord_id"], f"{user['name']} accepted the invite for {u['label']}", None, "system")
    else:
        need(user, "handyman")
        await db.landlord_handymen.update_one({"landlord_id": inv["landlord_id"], "handyman_id": user["id"]}, {"$set": {"landlord_id": inv["landlord_id"], "handyman_id": user["id"]}}, upsert=True)
        await activity(inv["landlord_id"], f"{user['name']} joined your handyman list", None, "system")
    return {"ok": True}


# ---------------- properties ----------------
@api.get("/zip/{z}")
async def zip_lookup(z: str):
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.get(f"https://api.zippopotam.us/us/{z}")
        if r.status_code != 200:
            raise HTTPException(404, "We couldn't find that ZIP. Check the 5 digits")
        p = r.json()["places"][0]
        st = p["state abbreviation"]
        return {"city": p["place name"], "state": st, "timezone": tz_for(st)}
    except httpx.HTTPError:
        raise HTTPException(503, "No internet to look up the ZIP. Type the city and state instead")


async def own_property(pid, user):
    p = await db.properties.find_one({"id": pid, "landlord_id": user["id"]}, NF)
    if not p:
        raise HTTPException(404, "Property not found")
    return p


@api.get("/properties")
async def list_props(user=Depends(get_user)):
    need(user, "landlord")
    out = []
    async for p in db.properties.find({"landlord_id": user["id"]}, NF).sort("created_at", 1):
        units = [u async for u in db.units.find({"property_id": p["id"]}, NF)]
        p["units_total"] = len(units)
        p["units_rented"] = len([u for u in units if u.get("tenant_id")])
        p["rent_total"] = sum(u["rent"] for u in units if u.get("tenant_id"))
        out.append(p)
    return out


@api.post("/properties")
async def create_prop(body: dict, user=Depends(get_user)):
    need(user, "landlord")
    st = (body.get("state") or "").upper()[:2]
    if not body.get("name") or not body.get("address") or not st:
        raise HTTPException(400, "Add a name, address and ZIP")
    p = {"id": uid(), "landlord_id": user["id"], "name": body["name"], "address": body["address"], "city": body.get("city", ""), "state": st, "zip": body.get("zip", ""),
         "timezone": tz_for(st), "rental_type": body.get("rental_type", "whole"), "house_rules": body.get("house_rules", ""),
         "utilities": body.get("utilities") or {"electric": "", "gas": "", "internet": ""}, "photo": body.get("photo") or f"preset:{await db.properties.count_documents({'landlord_id': user['id']}) % 6}",
         "is_sample": False, "created_at": iso()}
    await db.properties.insert_one(dict(p))
    units = body.get("units") or [{"label": "Whole home", "rent": body.get("rent", 0), "due_day": 1}]
    if p["rental_type"] == "whole":
        units = units[:1]
        units[0]["label"] = "Whole home"
    for u in units:
        await db.units.insert_one({"id": uid(), "property_id": p["id"], "landlord_id": user["id"], "label": u.get("label") or "Room", "rent": float(u.get("rent") or 0),
                                   "due_day": int(u.get("due_day") or 1), "tenant_id": None, "active_from": None, "access_notes": ""})
    return p


async def _insp_sum(u, kind):
    if not u.get("tenant_id"):
        return None
    i = await db.inspections.find_one({"unit_id": u["id"], "tenant_id": u["tenant_id"], "kind": kind}, NF, sort=[("created_at", -1)])
    return {"id": i["id"], "status": i["status"], "statement_id": i.get("statement_id"), "due_by": i.get("due_by")} if i else None


@api.get("/properties/{pid}")
async def get_prop(pid: str, user=Depends(get_user)):
    need(user, "landlord")
    p = await own_property(pid, user)
    units = []
    async for u in db.units.find({"property_id": pid}, NF):
        t = await db.users.find_one({"id": u["tenant_id"]}, NF) if u.get("tenant_id") else None
        ob = await db.onboarding.find_one({"tenant_id": u["tenant_id"]}, NF) if t else None
        inv = await db.invites.find_one({"unit_id": u["id"], "status": "pending"}, NF)
        lease = await db.leases.find_one({"unit_id": u["id"], "status": {"$ne": "void"}}, NF, sort=[("created_at", -1)])
        steps = 0
        if ob:
            steps = int(bool(ob.get("lease_signed"))) + int(bool((ob.get("insurance") or {}).get("done"))) + int(all((ob.get("utilities") or {}).get(k) for k in ("electric", "gas", "internet")))
        units.append({**u, "tenant": {"id": t["id"], "name": t["name"], "is_sample": t.get("is_sample")} if t else None, "invite": inv,
                      "onboarding_steps": steps, "lease": {"id": lease["id"], "status": lease["status"]} if lease else None,
                      "move_in": await _insp_sum(u, "move_in"), "move_out": await _insp_sum(u, "move_out")})
    p["units"] = units
    p["state_rules"] = STATE_RULES.get(p["state"])
    return p


@api.patch("/properties/{pid}")
async def patch_prop(pid: str, body: dict, user=Depends(get_user)):
    need(user, "landlord")
    await own_property(pid, user)
    allowed = {k: v for k, v in body.items() if k in ("name", "address", "house_rules", "utilities", "photo", "city", "state", "zip")}
    await db.properties.update_one({"id": pid}, {"$set": allowed})
    return await db.properties.find_one({"id": pid}, NF)


@api.post("/properties/{pid}/units")
async def add_unit(pid: str, body: dict, user=Depends(get_user)):
    need(user, "landlord")
    await own_property(pid, user)
    u = {"id": uid(), "property_id": pid, "landlord_id": user["id"], "label": body.get("label") or "Room", "rent": float(body.get("rent") or 0),
         "due_day": int(body.get("due_day") or 1), "tenant_id": None, "active_from": None, "access_notes": ""}
    await db.units.insert_one(dict(u))
    return u


@api.patch("/units/{unit_id}")
async def patch_unit(unit_id: str, body: dict, user=Depends(get_user)):
    need(user, "landlord")
    allowed = {k: (float(v) if k == "rent" else int(v) if k == "due_day" else v) for k, v in body.items() if k in ("label", "rent", "due_day", "access_notes")}
    r = await db.units.update_one({"id": unit_id, "landlord_id": user["id"]}, {"$set": allowed})
    if not r.matched_count:
        raise HTTPException(404, "Room not found")
    return {"ok": True}


@api.post("/units/{unit_id}/invite")
async def invite_tenant(unit_id: str, body: dict, user=Depends(get_user)):
    need(user, "landlord")
    email = (body.get("email") or "").strip().lower()
    if "@" not in email:
        raise HTTPException(400, "Enter the tenant's Google email")
    u = await db.units.find_one({"id": unit_id, "landlord_id": user["id"]}, NF)
    if not u:
        raise HTTPException(404, "Room not found")
    if u.get("tenant_id"):
        old = await db.users.find_one({"id": u["tenant_id"]}, NF)
        if old and old.get("is_sample") and body.get("replace"):
            await db.units.update_one({"id": unit_id}, {"$set": {"tenant_id": None, "active_from": None}})
        else:
            raise HTTPException(409, "This room already has a tenant")
    await db.invites.update_many({"unit_id": unit_id, "status": "pending"}, {"$set": {"status": "cancelled"}})
    inv = {"id": uid(), "kind": "tenant", "landlord_id": user["id"], "unit_id": unit_id, "email": email, "status": "pending", "created_at": iso()}
    await db.invites.insert_one(dict(inv))
    await activity(user["id"], f"Invited {email} to {u['label']}", None, "system")
    return inv


@api.delete("/invites/{iid}")
async def cancel_invite(iid: str, user=Depends(get_user)):
    await db.invites.update_one({"id": iid, "landlord_id": user["id"]}, {"$set": {"status": "cancelled"}})
    return {"ok": True}


# ---------------- handymen ----------------
def hm_public(h):
    return {k: h.get(k) for k in ("user_id", "name", "trades", "city", "state", "rating_avg", "rating_count", "jobs_done", "is_sample")}


@api.get("/handymen/mine")
async def my_handymen(user=Depends(get_user)):
    need(user, "landlord")
    ids = [x["handyman_id"] async for x in db.landlord_handymen.find({"landlord_id": user["id"]}, NF)]
    out = []
    async for h in db.handymen.find({"user_id": {"$in": ids}}, NF):
        jobs = await db.tickets.count_documents({"landlord_id": user["id"], "handyman_id": h["user_id"], "status": "closed"})
        last = await db.tickets.find_one({"landlord_id": user["id"], "handyman_id": h["user_id"]}, NF, sort=[("created_at", -1)])
        out.append({**hm_public(h), "jobs_for_you": jobs, "last_job": last["title"] if last else None})
    invites = [i async for i in db.invites.find({"landlord_id": user["id"], "kind": "handyman", "status": "pending"}, NF)]
    return {"handymen": out, "invites": invites}


@api.get("/handymen/market")
async def market(trade: str | None = None, user=Depends(get_user)):
    need(user, "landlord")
    states = list({p["state"] async for p in db.properties.find({"landlord_id": user["id"]}, NF)})
    mine = [x["handyman_id"] async for x in db.landlord_handymen.find({"landlord_id": user["id"]}, NF)]
    q = await flows.visible_handymen_query(user["id"])
    q["state"] = {"$in": states}
    q["user_id"] = {"$nin": mine}
    if trade:
        q["trades"] = trade
    return [hm_public(h) async for h in db.handymen.find(q, NF).sort("rating_avg", -1)]


@api.post("/handymen/{hid}/add")
async def add_hm(hid: str, user=Depends(get_user)):
    need(user, "landlord")
    q = await flows.visible_handymen_query(user["id"])
    if not await db.handymen.find_one({**q, "user_id": hid}):
        raise HTTPException(404, "Handyman not found")
    await db.landlord_handymen.update_one({"landlord_id": user["id"], "handyman_id": hid}, {"$set": {"landlord_id": user["id"], "handyman_id": hid}}, upsert=True)
    return {"ok": True}


@api.delete("/handymen/{hid}")
async def remove_hm(hid: str, user=Depends(get_user)):
    await db.landlord_handymen.delete_one({"landlord_id": user["id"], "handyman_id": hid})
    return {"ok": True}


@api.post("/handymen/invite")
async def invite_hm(body: dict, user=Depends(get_user)):
    need(user, "landlord")
    email = (body.get("email") or "").strip().lower()
    if "@" not in email:
        raise HTTPException(400, "Enter the handyman's Google email")
    inv = {"id": uid(), "kind": "handyman", "landlord_id": user["id"], "unit_id": None, "email": email, "status": "pending", "created_at": iso()}
    await db.invites.insert_one(dict(inv))
    return inv


@api.get("/handymen/{hid}")
async def hm_detail(hid: str, user=Depends(get_user)):
    need(user, "landlord")
    h = await db.handymen.find_one({"user_id": hid, **(await flows.visible_handymen_query(user["id"]))}, NF)
    if not h:
        raise HTTPException(404, "Handyman not found")
    jobs = [{"id": t["id"], "title": t["title"], "status": t["status"], "paid": t.get("paid_amount"), "date": t["created_at"], "rating": t.get("rating")}
            async for t in db.tickets.find({"landlord_id": user["id"], "handyman_id": hid}, NF).sort("created_at", -1)]
    mine = bool(await db.landlord_handymen.find_one({"landlord_id": user["id"], "handyman_id": hid}))
    return {**hm_public(h), "jobs": jobs, "paid_total": sum(j["paid"] or 0 for j in jobs if j["status"] == "closed"), "on_my_list": mine}


@api.post("/handyman/setup")
async def hm_setup(body: dict, user=Depends(get_user)):
    need(user, "handyman")
    trades = [t for t in body.get("trades") or [] if t]
    if not trades or not body.get("zip"):
        raise HTTPException(400, "Pick at least one trade and add your ZIP")
    doc = {"user_id": user["id"], "name": user["name"], "trades": trades, "city": body.get("city", ""), "state": (body.get("state") or "").upper(), "zip": body["zip"],
           "phone": body.get("phone", ""), "is_sample": False}
    await db.handymen.update_one({"user_id": user["id"]}, {"$set": doc, "$setOnInsert": {"rating_avg": 0, "rating_count": 0, "jobs_done": 0, "earnings_total": 0}}, upsert=True)
    return {"ok": True}


@api.get("/handyman/profile")
async def hm_profile(user=Depends(get_user)):
    need(user, "handyman")
    h = await db.handymen.find_one({"user_id": user["id"]}, NF) or {}
    start = period_of()
    paid = [t async for t in db.tickets.find({"handyman_id": user["id"], "status": "closed", "closed_at": {"$regex": f"^{start}"}}, NF)]
    return {**h, "earnings_month": sum(t.get("paid_amount") or 0 for t in paid), "email": user["email"]}


# ---------------- tickets ----------------
STEP = {"reported": 0, "finding_handyman": 0, "offered": 1, "awaiting_tenant_time": 1, "booked": 2, "fixed_pending_confirm": 3, "payment_pending_approval": 3, "closed": 4,
        "self_fix_limit_pending": 0, "self_fix_approved": 0, "receipt_submitted": 3, "reimbursement_pending_approval": 3, "needs_landlord": 1, "cancelled": 0}
POST_BOOK = ("booked", "fixed_pending_confirm", "payment_pending_approval", "closed")


def can_see(t, user):
    uid_ = user["id"]
    return uid_ in (t["tenant_id"], t["landlord_id"], t.get("handyman_id")) or user.get("acting_by") == t["landlord_id"]


async def ticket_view(t, user):
    prop = await db.properties.find_one({"id": t["property_id"]}, NF)
    unit = await db.units.find_one({"id": t["unit_id"]}, NF)
    tenant = await db.users.find_one({"id": t["tenant_id"]}, NF)
    h = await db.handymen.find_one({"user_id": t["handyman_id"]}, NF) if t.get("handyman_id") else None
    v = dict(t)
    v.pop("receipt_hash", None)
    v["step"] = STEP.get(t["status"], 0)
    v["self_fix"] = t["status"].startswith("self_fix") or t["status"] in ("receipt_submitted", "reimbursement_pending_approval") or bool(t.get("self_fix_limit") and not t.get("handyman_id"))
    v["unit_label"] = unit["label"] if unit else ""
    v["property_name"] = prop["name"]
    v["city"] = prop["city"]
    v["timezone"] = prop["timezone"]
    v["tenant_name"] = first(tenant["name"]) if user["role"] == "handyman" else tenant["name"]
    v["handyman"] = hm_public(h) if h else None
    role = user["role"]
    if role == "handyman":
        v["address"] = f"{prop['address']}, {prop['city']} {prop['state']} · {unit['label']}" if t["status"] in POST_BOOK else None
        v["access_notes"] = unit.get("access_notes") if t["status"] in POST_BOOK else None
        for k in ("approved_amount", "self_fix_limit", "declined_by", "summary"):
            v.pop(k, None)
    else:
        v["address"] = f"{prop['address']}, {prop['city']} {prop['state']}"
    th = await db.threads.find_one({"kind": "tenant", "tenant_id": t["tenant_id"]}, NF)
    v["tenant_thread_id"] = th["id"] if th and role != "handyman" else None
    v["job_thread_id"] = t.get("job_thread_id") if role != "tenant" else None
    v["pending_approval"] = await db.approvals.find_one({"ticket_id": t["id"], "status": "pending"}, NF) if role == "landlord" else None
    return v


async def my_ticket(tid, user):
    t = await flows.get_ticket(tid)
    if not can_see(t, user):
        raise HTTPException(404, "Ticket not found")
    return t


@api.get("/tickets")
async def list_tickets(user=Depends(get_user)):
    q = {"landlord": {"landlord_id": user["id"]}, "tenant": {"tenant_id": user["id"]}, "handyman": {"handyman_id": user["id"]}}.get(user["role"])
    if q is None:
        raise HTTPException(403, "Pick a role first")
    return [await ticket_view(t, user) async for t in db.tickets.find(q, NF).sort("created_at", -1).limit(100)]


@api.get("/tickets/{tid}")
async def get_ticket_ep(tid: str, user=Depends(get_user)):
    return await ticket_view(await my_ticket(tid, user), user)


@api.post("/tickets/{tid}/accept")
async def t_accept(tid: str, body: dict, user=Depends(get_user)):
    need(user, "handyman")
    slots = body.get("slots") or []
    if not body.get("quote") or len(slots) < 1:
        raise HTTPException(400, "Add your price and at least one time")
    await flows.handyman_accept(await my_ticket(tid, user), user["id"], float(body["quote"]), slots)
    return {"ok": True}


@api.post("/tickets/{tid}/decline")
async def t_decline(tid: str, user=Depends(get_user)):
    need(user, "handyman")
    t = await my_ticket(tid, user)
    if t["status"] != "offered":
        raise HTTPException(409, "This offer is no longer open")
    await flows.handyman_decline(t, user["id"], "declined")
    return {"ok": True}


@api.post("/tickets/{tid}/pick-slot")
async def t_pick(tid: str, body: dict, user=Depends(get_user)):
    need(user, "tenant")
    booked = await flows.pick_slot(await my_ticket(tid, user), body.get("slot"))
    return {"ok": True, "booked": booked}


@api.post("/tickets/{tid}/mark-fixed")
async def t_fixed(tid: str, body: dict, user=Depends(get_user)):
    need(user, "handyman")
    await flows.mark_fixed(await my_ticket(tid, user), user["id"], float(body.get("final_amount") or 0), body.get("after_photo_id"), body.get("receipt_id"))
    return {"ok": True}


@api.post("/tickets/{tid}/confirm")
async def t_confirm(tid: str, body: dict, user=Depends(get_user)):
    need(user, "tenant")
    await flows.confirm_fixed(await my_ticket(tid, user), bool(body.get("ok")), body.get("note", ""))
    return {"ok": True}


@api.post("/tickets/{tid}/rate")
async def t_rate(tid: str, body: dict, user=Depends(get_user)):
    need(user, "tenant")
    stars = int(body.get("stars") or 0)
    if not 1 <= stars <= 5:
        raise HTTPException(400, "Pick 1 to 5 stars")
    await flows.rate(await my_ticket(tid, user), stars)
    return {"ok": True}


@api.post("/tickets/{tid}/self-fix")
async def t_selffix(tid: str, user=Depends(get_user)):
    need(user, "tenant")
    await flows.start_self_fix(await my_ticket(tid, user), "tenant")
    return {"ok": True}


@api.post("/tickets/{tid}/receipt")
async def t_receipt(tid: str, body: dict, user=Depends(get_user)):
    need(user, "tenant")
    t = await my_ticket(tid, user)
    f = await db.files.find_one({"id": body.get("receipt_id"), "owner_id": user["id"]}, NF)
    if not f:
        raise HTTPException(400, "Please add the receipt photo")
    info = await agent.read_receipt(f["id"])
    amount = body.get("amount")
    note = ""
    if info.get("readable") and info.get("total"):
        if not amount:
            amount = info["total"]
        elif abs(float(amount) - float(info["total"])) > 1:
            note = f"✦ The receipt shows {money(info['total'])}, the tenant typed {money(amount)}."
        if info.get("store"):
            note = (note + f" Store: {info['store']}{', ' + info['date'] if info.get('date') else ''}.").strip()
    elif info and not info.get("readable"):
        raise HTTPException(400, "I couldn't read that receipt. Please take a clearer photo in good light")
    if not amount:
        raise HTTPException(400, "Enter the receipt total")
    await flows.submit_receipt(t, f["id"], body.get("after_photo_id"), float(amount), f["hash"], note)
    return {"ok": True}


@api.post("/tickets/{tid}/cancel")
async def t_cancel(tid: str, user=Depends(get_user)):
    t = await my_ticket(tid, user)
    if user["id"] not in (t["tenant_id"], t["landlord_id"]):
        raise HTTPException(403, "Only the tenant or owner can cancel")
    await db.tickets.update_one({"id": tid, "status": {"$nin": ["closed"]}}, {"$set": {"status": "cancelled"}})
    await db.approvals.update_many({"ticket_id": tid, "status": "pending"}, {"$set": {"status": "declined"}})
    await activity(t["landlord_id"], f"Ticket cancelled: {t['title']}", tid)
    return {"ok": True}


@api.get("/handyman/jobs")
async def hm_jobs(user=Depends(get_user)):
    need(user, "handyman")
    ts = [await ticket_view(t, user) async for t in db.tickets.find({"handyman_id": user["id"]}, NF).sort("created_at", -1)]
    return {"offers": [t for t in ts if t["status"] == "offered"],
            "booked": [t for t in ts if t["status"] in ("awaiting_tenant_time", "booked", "fixed_pending_confirm")],
            "done": [t for t in ts if t["status"] in ("payment_pending_approval", "closed")],
            "missed": [{"id": t["id"], "title": t["title"], "trade": t["trade"], "city": (await db.properties.find_one({"id": t["property_id"]}, NF) or {}).get("city"),
                        "reason": next((m["reason"] for m in reversed(t.get("missed") or []) if m["hid"] == user["id"]), "declined"),
                        "at": next((m["at"] for m in reversed(t.get("missed") or []) if m["hid"] == user["id"]), t["created_at"])}
                       async for t in db.tickets.find({"declined_by": user["id"], "handyman_id": {"$ne": user["id"]}}, NF).sort("created_at", -1).limit(20)]}


# ---------------- threads ----------------
async def thread_access(thread_id, user):
    t = await db.threads.find_one({"id": thread_id}, NF)
    if not t:
        raise HTTPException(404, "Chat not found")
    u = user["id"]
    write = (t["kind"] == "tenant" and t["tenant_id"] == u) or (t["kind"] == "job" and t["handyman_id"] == u) or (t["kind"] == "landlord" and t["landlord_id"] == u)
    read = write or t["landlord_id"] in (u, user.get("acting_by"))
    if not read:
        raise HTTPException(404, "Chat not found")
    return t, write


@api.get("/threads/mine")
async def my_thread(user=Depends(get_user)):
    if user["role"] == "tenant":
        unit = await db.units.find_one({"tenant_id": user["id"]}, NF)
        if not unit:
            raise HTTPException(404, "No home linked yet")
        return await tenant_thread(user["id"], unit["landlord_id"])
    if user["role"] == "landlord":
        return await landlord_thread(user["id"])
    raise HTTPException(404, "Open a job to chat")


@api.get("/threads/{thread_id}")
async def get_thread(thread_id: str, after: str | None = None, user=Depends(get_user)):
    t, write = await thread_access(thread_id, user)
    q = {"thread_id": thread_id}
    if after:
        q["created_at"] = {"$gt": after}
    msgs = [m async for m in db.messages.find(q, NF).sort("created_at", -1).limit(80)]
    title = "Rentwise"
    if t["kind"] == "job":
        tk = await db.tickets.find_one({"id": t["ticket_id"]}, NF)
        hm = await db.users.find_one({"id": t["handyman_id"]}, NF)
        title = f"Rentwise ↔ {first(hm['name'])} · {tk['title']}"
    elif t["kind"] == "tenant" and user["id"] != t["tenant_id"]:
        tn = await db.users.find_one({"id": t["tenant_id"]}, NF)
        title = f"Rentwise ↔ {first(tn['name'])}"
    return {"thread": t, "messages": list(reversed(msgs)), "can_write": write, "title": title}


@api.post("/threads/{thread_id}/messages")
async def send_msg(thread_id: str, body: dict, user=Depends(get_user)):
    t, write = await thread_access(thread_id, user)
    if not write:
        raise HTTPException(403, "This chat is read-only for you")
    text = (body.get("text") or "").strip()[:2000]
    atts = [a for a in body.get("attachments") or [] if await db.files.find_one({"id": a, "owner_id": user["id"]})]
    if not text and not atts:
        raise HTTPException(400, "Type a message")
    got = await db.threads.find_one_and_update({"id": thread_id, "busy": {"$ne": True}}, {"$set": {"busy": True, "busy_at": iso()}})
    if not got:
        raise HTTPException(409, "Rentwise is still replying — one moment")
    m = await post(thread_id, text, role="user", attachments=atts, sender_id=user["id"])
    if t["kind"] == "job":
        await db.files.update_many({"id": {"$in": atts}}, {"$set": {"ticket_id": t["ticket_id"]}})
    asyncio.create_task(agent.run_turn(thread_id, user, text, atts))
    return m


# ---------------- files ----------------
@api.post("/upload")
async def upload(file: UploadFile = File(...), user=Depends(get_user)):
    data = await file.read()
    ext = (file.filename or "f.jpg").rsplit(".", 1)[-1].lower()[:5]
    is_video = (file.content_type or "") in ("video/mp4", "video/quicktime") or ext in ("mp4", "mov")
    if is_video and len(data) > VIDEO_MAX_MB * 1024 * 1024:
        raise HTTPException(413, f"That video is too big. Please keep it under {VIDEO_MAX_MB} MB")
    if not is_video and len(data) > 12 * 1024 * 1024:
        raise HTTPException(413, "That file is too big. Please pick one under 12 MB")
    if not (is_video or (file.content_type or "").startswith("image/") or file.content_type == "application/pdf" or ext in ("jpg", "jpeg", "png", "heic", "webp", "pdf")):
        raise HTTPException(415, "Please upload a photo, a video or a PDF")
    if is_video and ext not in ("mp4", "mov"):
        ext = "mov" if file.content_type == "video/quicktime" else "mp4"
    fid = uid()
    path = f"{APP_NAME}/uploads/{user['id']}/{fid}.{ext}"
    ctype = file.content_type or "image/jpeg"
    try:
        res = await asyncio.to_thread(put_object, path, data, ctype)
    except Exception as e:  # noqa: BLE001
        log.error("upload failed %s", e)
        raise HTTPException(503, "Upload didn't go through. Tap to try again")
    rec = {"id": fid, "path": res.get("path", path), "owner_id": user["id"], "content_type": ctype, "hash": hashlib.sha256(data).hexdigest(), "ticket_id": None, "created_at": iso()}
    await db.files.insert_one(dict(rec))
    return {"id": fid}


@api.get("/files/{fid}")
async def get_file(fid: str, request: Request, user=Depends(get_media_user)):
    f = await db.files.find_one({"id": fid}, NF)
    if not f:
        raise HTTPException(404, "File not found")
    ok = f["owner_id"] in (user["id"], user.get("acting_by"))
    if not ok and f.get("ticket_id"):
        t = await db.tickets.find_one({"id": f["ticket_id"]}, NF)
        ok = bool(t and can_see(t, user))
    if not ok and f.get("inspection_id"):
        insp = await db.inspections.find_one({"id": f["inspection_id"]}, NF)
        ok = bool(insp and user.get("role") != "handyman" and (user["id"] in (insp["tenant_id"], insp["landlord_id"]) or user.get("acting_by") == insp["landlord_id"]))
    if not ok and user["role"] == "landlord":
        p = await db.properties.find_one({"photo": fid, "landlord_id": user["id"]})
        ok = bool(p)
    if not ok:
        raise HTTPException(404, "File not found")
    data, ctype = await asyncio.to_thread(get_object, f["path"])
    media = f.get("content_type") or ctype
    rng = request.headers.get("range", "")
    m = re.match(r"bytes=(\d*)-(\d*)", rng)
    if m and (m.group(1) or m.group(2)):  # iOS video players need partial content
        size = len(data)
        start = int(m.group(1)) if m.group(1) else max(0, size - int(m.group(2)))
        end = min(int(m.group(2)), size - 1) if m.group(1) and m.group(2) else size - 1
        if start >= size or start > end:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
        return Response(data[start:end + 1], status_code=206, media_type=media,
                        headers={"Content-Range": f"bytes {start}-{end}/{size}", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=86400"})
    return Response(data, media_type=media, headers={"Cache-Control": "private, max-age=86400", "Accept-Ranges": "bytes"})


# ---------------- landlord home / approvals ----------------
@api.get("/landlord/home")
async def ll_home(user=Depends(get_user)):
    need(user, "landlord")
    apps = [a async for a in db.approvals.find({"landlord_id": user["id"], "status": "pending"}, NF).sort([("urgent", -1), ("created_at", -1)])]
    for a in apps:
        if a.get("ticket_id"):
            t = await db.tickets.find_one({"id": a["ticket_id"]}, NF)
            a["ticket_title"] = t["title"] if t else None
            a["after_photos"] = (t or {}).get("after_photos") or []
            a["receipt_id"] = (t or {}).get("receipt_path")
            a["photos"] = (t or {}).get("photos") or []
    leases = []
    async for le in db.leases.find({"landlord_id": user["id"], "status": "tenant_signed"}, NF):
        tn = await db.users.find_one({"id": le["tenant_id"]}, NF)
        leases.append({"id": le["id"], "title": f"{first(tn['name']) if tn else 'Tenant'} signed — sign your part"})
    acts = [a async for a in db.activity.find({"landlord_id": user["id"]}, NF).sort("created_at", -1).limit(25)]
    from money import overview
    ov = await overview(user)
    open_t = await db.tickets.count_documents({"landlord_id": user["id"], "status": {"$nin": ["closed", "cancelled"]}})
    closed = [t async for t in db.tickets.find({"landlord_id": user["id"], "status": "closed"}, NF)]
    flagged = {a["ticket_id"] async for a in db.approvals.find({"landlord_id": user["id"], "kind": "other", "urgent": {"$ne": True}}, NF)}
    fwy = [t for t in closed if t["id"] not in flagged]
    hrs = []
    for t in fwy:
        if t.get("fixed_at"):
            from datetime import datetime
            hrs.append((datetime.fromisoformat(t["fixed_at"]) - datetime.fromisoformat(t["created_at"])).total_seconds() / 3600)
    taps = 0
    for t in fwy:
        taps += await db.approvals.count_documents({"ticket_id": t["id"], "status": "approved"}) if not t.get("landlord_taps") else t["landlord_taps"]
    return {"approvals": apps, "leases_to_sign": leases, "activity": acts,
            "stats": {"collected": ov["collected"], "overdue": ov["overdue"], "open_tickets": open_t, "fixed_without_you": len(fwy),
                      "avg_hours": round(sum(hrs) / len(hrs), 1) if hrs else None, "taps": taps}, "month": ov["month"]}


@api.post("/approvals/{aid}/decide")
async def decide(aid: str, body: dict, user=Depends(get_user)):
    need(user, "landlord")
    if user.get("acting_by"):
        raise HTTPException(403, "Switch back to your own view to approve money")
    return await flows.decide(user["id"], aid, body.get("action", "approve"), body.get("amount"), body.get("option"))


# ---------------- tenant ----------------
@api.get("/tenant/home")
async def tenant_home(user=Depends(get_user)):
    need(user, "tenant")
    unit = await db.units.find_one({"tenant_id": user["id"]}, NF)
    if not unit:
        return {"unit": None, "invites": await pending_invites(user) if not user.get("is_sample") else []}
    prop = await db.properties.find_one({"id": unit["property_id"]}, NF)
    ob = await db.onboarding.find_one({"tenant_id": user["id"]}, NF) or {"lease_signed": False, "insurance": {"done": False}, "utilities": {}}
    lease = await db.leases.find_one({"unit_id": unit["id"], "tenant_id": user["id"], "status": {"$in": ["sent", "tenant_signed", "signed"]}}, NF, sort=[("created_at", -1)])
    tickets = [await ticket_view(t, user) async for t in db.tickets.find({"tenant_id": user["id"], "status": {"$nin": ["closed", "cancelled"]}}, NF).sort("created_at", -1)]
    ll = await db.users.find_one({"id": unit["landlord_id"]}, NF)
    return {"unit": unit, "property": {k: prop[k] for k in ("name", "address", "city", "state", "utilities", "house_rules", "photo")}, "onboarding": ob,
            "lease": {"id": lease["id"], "status": lease["status"], "terms": lease["terms"]} if lease else None, "tickets": tickets,
            "next_due": await oldest_unpaid(unit), "deposit_due": await deposit_due(unit), "landlord_name": ll["name"]}


@api.patch("/tenant/onboarding")
async def tenant_ob(body: dict, user=Depends(get_user)):
    need(user, "tenant")
    upd = {}
    if "insurance" in body:
        i = body["insurance"]
        upd["insurance"] = {"done": bool(i.get("provider") and (i.get("policy_no") or i.get("proof_id"))), "provider": i.get("provider", ""), "policy_no": i.get("policy_no", ""), "proof_path": i.get("proof_id")}
    for k in ("electric", "gas", "internet"):
        if k in (body.get("utilities") or {}):
            upd[f"utilities.{k}"] = bool(body["utilities"][k])
    await db.onboarding.update_one({"tenant_id": user["id"]}, {"$set": upd}, upsert=True)
    return await db.onboarding.find_one({"tenant_id": user["id"]}, NF)


@api.get("/state-rules/{st}")
async def state_rules(st: str):
    r = STATE_RULES.get(st.upper())
    if not r:
        raise HTTPException(404, "We don't have rules for this state yet")
    return {**r, "deposit_months": DEPOSIT_MONTHS.get(st.upper())}


# ---------------- leases ----------------
@api.post("/leases")
async def create_lease(body: dict, user=Depends(get_user)):
    need(user, "landlord")
    unit = await db.units.find_one({"id": body.get("unit_id"), "landlord_id": user["id"]}, NF)
    if not unit:
        raise HTTPException(404, "Room not found")
    prop = await db.properties.find_one({"id": unit["property_id"]}, NF)
    inv = await db.invites.find_one({"unit_id": unit["id"], "status": "pending"}, NF)
    tenant = await db.users.find_one({"id": unit["tenant_id"]}, NF) if unit.get("tenant_id") else None
    if not tenant and not inv:
        raise HTTPException(400, "Invite a tenant to this room first")
    terms = body.get("terms") or {}
    if await db.leases.find_one({"unit_id": unit["id"], "status": "signed", "source": "upload"}):
        raise HTTPException(409, "This room already has a signed lease on file")
    for k in ("rent", "deposit", "start", "end"):
        if terms.get(k) in (None, ""):
            raise HTTPException(400, "Add rent, deposit, start and end dates")
    terms = {**terms, "rent": float(terms["rent"]), "deposit": float(terms["deposit"]), "due_day": int(terms.get("due_day") or unit["due_day"])}
    tname = tenant["name"] if tenant else (body.get("tenant_name") or inv["email"])
    text, chunks = lease_text(terms, prop, unit, user["name"], tname)
    await db.leases.update_many({"unit_id": unit["id"], "status": {"$in": ["draft", "sent"]}}, {"$set": {"status": "void"}})
    le = {"id": uid(), "unit_id": unit["id"], "tenant_id": tenant["id"] if tenant else None, "invite_id": inv["id"] if inv and not tenant else None, "landlord_id": user["id"],
          "terms": terms, "text": text, "chunks": chunks, "status": "sent", "signatures": [], "doc_hash": doc_hash(text), "created_at": iso()}
    months = DEPOSIT_MONTHS.get(prop["state"])
    if months and terms["deposit"] > months * terms["rent"]:
        le["warning"] = f"{STATE_RULES[prop['state']]['name']} limits deposits to {STATE_RULES[prop['state']]['deposit_limit']}."
    await db.leases.insert_one(dict(le))
    le.pop("_id", None)
    if tenant:
        th = await tenant_thread(tenant["id"], user["id"])
        await post(th["id"], "Your lease is ready to review and sign. Open it from Home.", cards=[{"type": "lease", "lease_id": le["id"]}])
    await activity(user["id"], f"Lease sent for {unit['label']}", None, "system")
    return le


async def _lease_unit(user, unit_id):
    need(user, "landlord")
    unit = await db.units.find_one({"id": unit_id, "landlord_id": user["id"]}, NF)
    if not unit:
        raise HTTPException(404, "Room not found")
    inv = await db.invites.find_one({"unit_id": unit["id"], "status": "pending"}, NF)
    if not unit.get("tenant_id") and not inv:
        raise HTTPException(400, "Invite a tenant to this room first")
    return unit, inv


def _pdf_text(data):
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    return "\n".join((p.extract_text() or "") for p in reader.pages).strip()


def _chunks(text):
    parts = [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n\s*\n", text)]
    parts = [p for p in parts if len(p) > 20]
    if len(parts) < 3:  # no blank lines in the PDF text: split by numbered clauses or sentences
        flat = re.sub(r"\s+", " ", text)
        parts = [p.strip() for p in re.split(r"(?<![-/\d])(?=\b\d{1,2}\.\s+[A-Z])", flat) if len(p.strip()) > 20]
    out = []
    for p in parts:
        while len(p) > 900:
            cut = p.rfind(". ", 0, 900) + 1 or 900
            out.append(p[:cut].strip())
            p = p[cut:].strip()
        if p:
            out.append(p)
    return out[:80]


EXTRACT_SYS = ("You read US residential leases. Return ONLY a JSON object with these keys: tenant_name (string), rent (number, monthly), "
               "deposit (number), start (YYYY-MM-DD), end (YYYY-MM-DD), due_day (1-28), late_fee (number), notice_days (number), "
               "pets (short sentence), utilities (short sentence), summary (one plain sentence describing the lease), "
               "missing (list of key names you could not find). Use null for anything not in the lease. Never invent values.")


@api.post("/leases/extract")
async def extract_lease(body: dict, user=Depends(get_user)):
    unit, _ = await _lease_unit(user, body.get("unit_id"))
    f = await db.files.find_one({"id": body.get("file_id"), "owner_id": user["id"]}, NF)
    if not f:
        raise HTTPException(404, "File not found")
    if f["content_type"] != "application/pdf" and not f["path"].endswith(".pdf"):
        raise HTTPException(415, "Please pick a PDF of the lease")
    data, _ = await read_file(f["id"])
    try:
        text = await asyncio.to_thread(_pdf_text, data)
    except Exception:  # noqa: BLE001
        raise HTTPException(422, "I couldn't open that PDF. Please try another copy")
    if len(text) < 200:
        raise HTTPException(422, "This PDF has no readable text (it may be a scan). Please upload a typed copy, or prepare the lease in Rentwise")
    raw = await agent.quick(EXTRACT_SYS, text[:60000], model=OPUS)
    m = re.search(r"\{.*\}", raw or "", re.S)
    try:
        terms = json.loads(m.group(0)) if m else None
    except ValueError:
        terms = None
    if not isinstance(terms, dict):
        raise HTTPException(502, "I couldn't read the terms just now. Tap to try again")
    if not terms.get("due_day"):
        terms["due_day"] = unit["due_day"]
    return {"file_id": f["id"], "terms": terms, "chunks": _chunks(text), "pages_text_len": len(text)}


@api.post("/leases/upload")
async def save_uploaded_lease(body: dict, user=Depends(get_user)):
    unit, inv = await _lease_unit(user, body.get("unit_id"))
    f = await db.files.find_one({"id": body.get("file_id"), "owner_id": user["id"]}, NF)
    if not f:
        raise HTTPException(404, "File not found")
    t = body.get("terms") or {}
    for k in ("rent", "deposit", "start", "end"):
        if t.get(k) in (None, ""):
            raise HTTPException(400, "Add rent, deposit, start and end dates")
    try:
        terms = {"rent": float(t["rent"]), "deposit": float(t["deposit"]), "start": str(t["start"])[:10], "end": str(t["end"])[:10],
                 "due_day": int(t.get("due_day") or unit["due_day"]),
                 "late_fee": float(t["late_fee"]) if t.get("late_fee") not in (None, "") else None,
                 "notice_days": int(float(t["notice_days"])) if t.get("notice_days") not in (None, "") else None,
                 "pets": t.get("pets") or "", "utilities": t.get("utilities") or "", "deposit_paid": bool(t.get("deposit_paid"))}
    except (TypeError, ValueError):
        raise HTTPException(400, "Rent, deposit and due day must be numbers")
    if terms["rent"] <= 0 or terms["deposit"] < 0 or not 1 <= terms["due_day"] <= 28:
        raise HTTPException(400, "Rent must be above $0 and the due day between 1 and 28")
    if await db.leases.find_one({"file_id": f["id"], "status": {"$ne": "void"}}):
        raise HTTPException(409, "This lease file is already saved")
    data, _ = await read_file(f["id"])
    text = await asyncio.to_thread(_pdf_text, data)
    chunks = _chunks(text)
    tenant_id = unit.get("tenant_id")
    await db.leases.update_many({"unit_id": unit["id"], "status": {"$ne": "void"}}, {"$set": {"status": "void"}})
    le = {"id": uid(), "unit_id": unit["id"], "tenant_id": tenant_id, "invite_id": inv["id"] if inv and not tenant_id else None, "landlord_id": user["id"],
          "terms": terms, "text": text, "chunks": chunks, "status": "signed", "source": "upload", "file_id": f["id"], "summary": t.get("summary") or "",
          "signatures": [], "doc_hash": f["hash"], "created_at": iso()}
    prop = await db.properties.find_one({"id": unit["property_id"]}, NF)
    months = DEPOSIT_MONTHS.get(prop["state"])
    if months and terms["deposit"] > months * terms["rent"]:
        le["warning"] = f"{STATE_RULES[prop['state']]['name']} limits deposits to {STATE_RULES[prop['state']]['deposit_limit']}."
    await db.leases.insert_one(dict(le))
    le.pop("_id", None)
    if tenant_id:
        await db.onboarding.update_one({"tenant_id": tenant_id}, {"$set": {"lease_signed": True}}, upsert=True)
        th = await tenant_thread(tenant_id, user["id"])
        await post(th["id"], f"Your signed lease is now saved in Rentwise. You can read it from Home any time, and ask me about it.", cards=[{"type": "lease", "lease_id": le["id"]}])
    await activity(user["id"], f"Signed lease uploaded for {unit['label']}", None, "system")
    return le


@api.get("/leases/{lid}")
async def get_lease(lid: str, user=Depends(get_user)):
    le = await db.leases.find_one({"id": lid}, NF)
    if not le or user["id"] not in (le["landlord_id"], le.get("tenant_id")):
        raise HTTPException(404, "Lease not found")
    return le


@api.post("/leases/{lid}/sign")
async def sign_lease(lid: str, body: dict, user=Depends(get_user)):
    le = await db.leases.find_one({"id": lid}, NF)
    if not le or user["id"] not in (le["landlord_id"], le.get("tenant_id")):
        raise HTTPException(404, "Lease not found")
    name = (body.get("typed_name") or "").strip()
    if len(name) < 3:
        raise HTTPException(400, "Type your full name to sign")
    if user["id"] == le.get("tenant_id"):
        frm, to, role = "sent", "tenant_signed", "tenant"
    else:
        if user.get("acting_by"):
            raise HTTPException(403, "Switch back to sign as the owner")
        frm, to, role = "tenant_signed", "signed", "landlord"
    r = await db.leases.find_one_and_update({"id": lid, "status": frm}, {"$set": {"status": to}, "$push": {"signatures": {"role": role, "typed_name": name, "signed_at": iso()}}}, projection=NF, return_document=True)
    if not r:
        raise HTTPException(409, "This lease isn't waiting for your signature")
    if to == "tenant_signed":
        await activity(le["landlord_id"], f"{name} signed the lease — sign your part", None, "system")
    else:
        await db.onboarding.update_one({"tenant_id": le["tenant_id"]}, {"$set": {"lease_signed": True}}, upsert=True)
        th = await tenant_thread(le["tenant_id"], le["landlord_id"])
        await post(th["id"], f"Your lease is fully signed. Your {money(le['terms']['deposit'])} deposit is now due — you can pay it in Payments.")
        await activity(le["landlord_id"], "Lease fully signed — deposit now due", None, "system")
    return r


@api.get("/leases/{lid}/pdf")
async def lease_pdf(lid: str, user=Depends(get_media_user)):
    le = await get_lease(lid, user)
    if le.get("file_id"):
        data, _ = await read_file(le["file_id"])
        return Response(data, media_type="application/pdf")
    lines = le["text"].split("\n\n") + ["SIGNATURES:"] + [f"{s['role'].title()}: /{s['typed_name']}/ signed {s['signed_at'][:19].replace('T', ' ')} UTC" for s in le["signatures"]]
    b = await asyncio.to_thread(pdf_bytes, "Residential Lease", lines, f"Document hash (SHA-256): {le['doc_hash']} · Simulated e-signature by Rentwise")
    return Response(b, media_type="application/pdf")


# ---------------- settings / memory / sample ----------------
@api.get("/settings")
async def get_settings(user=Depends(get_user)):
    return {"name": user["name"], "email": user["email"], "role": user["role"], "policies": user.get("policies") or [], "payment_details": user.get("payment_details", ""), "demo": DEMO}


@api.put("/settings")
async def put_settings(body: dict, user=Depends(get_user)):
    upd = {k: body[k] for k in ("name", "policies", "payment_details") if k in body}
    await db.users.update_one({"id": user["id"]}, {"$set": upd})
    return {"ok": True}


@api.get("/facts")
async def facts(user=Depends(get_user)):
    if user["role"] == "landlord":
        tids = [u["tenant_id"] async for u in db.units.find({"landlord_id": user["id"], "tenant_id": {"$ne": None}}, NF)]
        hids = [x["handyman_id"] async for x in db.landlord_handymen.find({"landlord_id": user["id"]}, NF)]
        pids = [p["id"] async for p in db.properties.find({"landlord_id": user["id"]}, NF)]
        q = {"scope_id": {"$in": tids + hids + pids + [user["id"]]}}
    else:
        q = {"scope_id": user["id"]}
    out = []
    async for f in db.memory_facts.find(q, NF).sort("created_at", -1):
        u = await db.users.find_one({"id": f["scope_id"]}, NF)
        f["about"] = u["name"] if u else "Property"
        out.append(f)
    return out


@api.delete("/facts/{fid}")
async def del_fact(fid: str, user=Depends(get_user)):
    allowed = [f["id"] for f in await facts(user)]
    if fid not in allowed:
        raise HTTPException(404, "Not found")
    await db.memory_facts.delete_one({"id": fid})
    return {"ok": True}


@api.post("/sample/reset")
async def sample_reset(user=Depends(get_user)):
    need(user, "landlord")
    if user.get("acting_by"):
        raise HTTPException(403, "Switch back first")
    res = await create_sample_home(user["id"])
    if DEMO and user["email"] == "test.landlord@rentwise.test":
        await seed_test_logins()
    return res


@api.get("/sample/people")
async def sample_people(user=Depends(get_user)):
    need(user, "landlord")
    return [{"id": u["id"], "name": u["name"], "role": u["role"]} async for u in db.users.find({"is_sample": True, "sample_owner_id": user["id"]}, NF)
            if u["role"] == "tenant" and await db.units.find_one({"tenant_id": u["id"]}) or u["role"] == "handyman" and await db.landlord_handymen.find_one({"handyman_id": u["id"], "landlord_id": user["id"]})]


app.include_router(api)
app.include_router(money_router)
app.include_router(plaid_router)
app.include_router(inspections_router)
app.include_router(voice_router)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


async def scheduler():
    while True:
        try:
            await flows.tick()
        except Exception as e:  # noqa: BLE001
            log.error("scheduler %s", e)
        await asyncio.sleep(15 if DEMO else 60)


async def seed_test_logins():
    """DEMO only: fixed bearer tokens for the automated testing agent. Never exposed in the app."""
    ll = await db.users.find_one({"email": "test.landlord@rentwise.test"}, NF)
    if not ll:
        ll = {"id": uid(), "email": "test.landlord@rentwise.test", "name": "Jordan Rivera", "picture": None, "role": "landlord", "is_sample": False, "created_at": iso()}
        await db.users.insert_one(dict(ll))
        await create_sample_home(ll["id"])
    await new_session(ll["id"], "test-landlord-token", True)
    nu = await db.users.find_one({"email": "test.new@rentwise.test"}, NF)
    if not nu:
        nu = {"id": uid(), "email": "test.new@rentwise.test", "name": "Casey New", "picture": None, "role": None, "is_sample": False, "created_at": iso()}
        await db.users.insert_one(dict(nu))
    await new_session(nu["id"], "test-new-token", True)
    for nm, tok in (("Tom Chen", "test-tenant-token"), ("Hank Miller", "test-handyman-token"), ("Maria Lopez", "test-tenant2-token")):
        u = await db.users.find_one({"name": nm, "is_sample": True, "sample_owner_id": ll["id"]}, NF)
        if u:
            await new_session(u["id"], tok, True)


@app.on_event("startup")
async def startup():
    await db.users.create_index("id", unique=True)
    await db.sessions.create_index("token", unique=True)
    await db.sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.locks.create_index("key", unique=True)
    await db.bank_txns.create_index("id", unique=True)
    await db.messages.create_index([("text", "text")])
    await db.messages.create_index([("thread_id", 1), ("created_at", 1)])
    await db.tickets.create_index("id", unique=True)
    await db.used_receipts.create_index("hash", unique=True)
    await db.plaid_links.create_index("link_token", unique=True)
    await db.plaid_items.create_index("item_id", unique=True)
    await db.threads.update_many({"busy": True}, {"$set": {"busy": False}})
    await seed_static()
    try:
        await asyncio.to_thread(init_storage)
    except Exception as e:  # noqa: BLE001
        log.error("storage init failed %s", e)
    if DEMO:
        await seed_test_logins()
    asyncio.create_task(scheduler())


@app.on_event("shutdown")
async def shutdown():
    from core import client
    client.close()
