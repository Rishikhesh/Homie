import os, re, uuid, logging, contextvars, asyncio, requests
from datetime import datetime, timezone, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from fastapi import Request, HTTPException  # noqa: E402

log = logging.getLogger("rentwise")
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]
DEMO = os.environ.get("DEMO_MODE") == "1"
LLM_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = os.environ.get("APP_NAME", "rentwise")
FOLLOWUP = int(os.environ.get("DEMO_FOLLOWUP_SECONDS", "60"))
NF = {"_id": 0}

# Models (single place)
SONNET = "claude-sonnet-5-5"
HAIKU = "claude-haiku-4-5-20251001"
OPUS = "claude-opus-5-5"

STATE_TZ = {"CA": "America/Los_Angeles", "WA": "America/Los_Angeles", "OR": "America/Los_Angeles", "NV": "America/Los_Angeles",
            "TX": "America/Chicago", "IL": "America/Chicago", "NY": "America/New_York", "FL": "America/New_York",
            "AZ": "America/Phoenix", "CO": "America/Denver"}


def now():
    return datetime.now(timezone.utc)


def iso(d=None):
    return (d or now()).isoformat()


def uid():
    return uuid.uuid4().hex[:16]


def period_of(d=None):
    d = d or now()
    return f"{d.year:04d}-{d.month:02d}"


def next_period(p):
    y, m = map(int, p.split("-"))
    return f"{y + (m // 12):04d}-{(m % 12) + 1:02d}"


def prev_period(p, n=1):
    y, m = map(int, p.split("-"))
    t = y * 12 + (m - 1) - n
    return f"{t // 12:04d}-{t % 12 + 1:02d}"


def month_name(p):
    y, m = map(int, p.split("-"))
    return datetime(y, m, 1).strftime("%B")


def tz_for(state):
    return STATE_TZ.get((state or "").upper(), "America/Los_Angeles")


def fmt_slot(s, tz="America/Los_Angeles"):
    d = datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(ZoneInfo(tz))
    h = d.strftime("%I").lstrip("0")
    mm = "" if d.minute == 0 else d.strftime(":%M")
    return f"{d.strftime('%a')} {h}{mm} {d.strftime('%p').lower()}"


def money(a):
    a = float(a or 0)
    return f"${a:,.0f}" if a == int(a) else f"${a:,.2f}"


CONTACT_RE = re.compile(r"([\w.+-]+@[\w-]+\.[\w.]+)|(\+?\d[\d\s().-]{7,}\d)")


def strip_contacts(t):
    return CONTACT_RE.sub("[contact removed]", t or "")


def first(name):
    return (name or "").split(" ")[0] or "there"


# ---------- auth ----------
async def get_user(request: Request) -> dict:
    h = request.headers.get("Authorization", "")
    token = h[7:] if h.startswith("Bearer ") else request.query_params.get("token")
    if not token:
        raise HTTPException(401, "Please sign in")
    s = await db.sessions.find_one({"token": token}, NF)
    if not s:
        raise HTTPException(401, "Session expired. Please sign in again")
    exp = s["expires_at"]
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < now():
        raise HTTPException(401, "Session expired. Please sign in again")
    user = await db.users.find_one({"id": s["user_id"]}, NF)
    if not user:
        raise HTTPException(401, "Please sign in")
    act = request.headers.get("X-Act-As") or request.query_params.get("act")
    if act and user.get("role") == "landlord" and act != user["id"]:
        t = await db.users.find_one({"id": act, "is_sample": True, "sample_owner_id": user["id"]}, NF)
        if not t:
            raise HTTPException(403, "You can only try your own sample people")
        t["acting_by"] = user["id"]
        return t
    return user


def need(user, *roles):
    if user.get("role") not in roles:
        raise HTTPException(403, "This screen isn't available for your account")


# ---------- storage ----------
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
_skey = None


def init_storage():
    global _skey
    if _skey:
        return _skey
    r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": LLM_KEY}, timeout=30)
    r.raise_for_status()
    _skey = r.json()["storage_key"]
    return _skey


def put_object(path, data, ctype):
    global _skey
    for _ in range(2):
        r = requests.put(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": init_storage(), "Content-Type": ctype}, data=data, timeout=120)
        if r.status_code == 503:
            _skey = None
            continue
        r.raise_for_status()
        return r.json()
    r.raise_for_status()


def get_object(path):
    r = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": init_storage()}, timeout=60)
    r.raise_for_status()
    return r.content, r.headers.get("Content-Type", "application/octet-stream")


async def read_file(file_id):
    f = await db.files.find_one({"id": file_id}, NF)
    if not f:
        return None, None
    return await asyncio.to_thread(get_object, f["path"])


# ---------- messaging / activity ----------
# During a tenant agent turn, notices for the tenant are handed to the agent instead of posted.
QUIET_TENANT = contextvars.ContextVar("quiet_tenant", default=None)


async def post(thread_id, text, role="assistant", cards=None, attachments=None, sender_id="agent"):
    m = {"id": uid(), "thread_id": thread_id, "role": role, "sender_id": sender_id, "text": text,
         "cards": cards or [], "attachments": attachments or [], "created_at": iso()}
    await db.messages.insert_one(dict(m))
    await db.threads.update_one({"id": thread_id}, {"$set": {"updated_at": m["created_at"]}})
    return m


async def tenant_thread(tenant_id, landlord_id=None):
    t = await db.threads.find_one({"kind": "tenant", "tenant_id": tenant_id}, NF)
    if not t:
        t = {"id": uid(), "kind": "tenant", "tenant_id": tenant_id, "landlord_id": landlord_id, "summary": "", "busy": False, "updated_at": iso()}
        await db.threads.insert_one(dict(t))
    return t


async def landlord_thread(landlord_id):
    t = await db.threads.find_one({"kind": "landlord", "landlord_id": landlord_id}, NF)
    if not t:
        t = {"id": uid(), "kind": "landlord", "landlord_id": landlord_id, "summary": "", "busy": False, "updated_at": iso()}
        await db.threads.insert_one(dict(t))
    return t


async def job_thread(ticket, handyman_id):
    t = await db.threads.find_one({"kind": "job", "ticket_id": ticket["id"], "handyman_id": handyman_id}, NF)
    if not t:
        t = {"id": uid(), "kind": "job", "ticket_id": ticket["id"], "handyman_id": handyman_id,
             "landlord_id": ticket["landlord_id"], "tenant_id": ticket["tenant_id"], "summary": "", "busy": False, "updated_at": iso()}
        await db.threads.insert_one(dict(t))
    return t


async def tell_tenant(ticket, text, cards=None, attachments=None):
    q = QUIET_TENANT.get()
    if q is not None and q.get("tenant_id") == ticket["tenant_id"]:
        q["notes"].append(text)
        q["cards"].extend(cards or [])
        return
    t = await tenant_thread(ticket["tenant_id"], ticket["landlord_id"])
    await post(t["id"], text, cards=cards, attachments=attachments)


async def tell_handyman(ticket, text, cards=None, handyman_id=None, attachments=None):
    hid = handyman_id or ticket.get("handyman_id")
    if not hid:
        return
    t = await job_thread(ticket, hid)
    await post(t["id"], text, cards=cards, attachments=attachments)


async def activity(landlord_id, text, ticket_id=None, kind="agent"):
    await db.activity.insert_one({"id": uid(), "landlord_id": landlord_id, "ticket_id": ticket_id, "text": text, "kind": kind, "created_at": iso()})


async def timeline(ticket_id, text, actor="agent"):
    await db.tickets.update_one({"id": ticket_id}, {"$push": {"timeline": {"at": iso(), "text": text, "actor": actor}}})


async def transition(ticket_id, expected, new, extra=None):
    """Atomic ticket status change; 409 if the ticket isn't in an expected status."""
    exp = [expected] if isinstance(expected, str) else expected
    upd = {"status": new, "status_at": iso(), **(extra or {})}
    t = await db.tickets.find_one_and_update({"id": ticket_id, "status": {"$in": exp}}, {"$set": upd}, projection=NF, return_document=True)
    if not t:
        raise HTTPException(409, "This ticket has already moved on. Pull down to refresh")
    return t
