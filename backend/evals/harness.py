"""Eval harness: drives the running backend over HTTP with the DEMO test logins and inspects Mongo afterwards."""
import io, os, re, time, uuid
from datetime import datetime, timedelta
from pathlib import Path
import requests
from dotenv import load_dotenv
from pymongo import MongoClient
from PIL import Image, ImageDraw

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
BASE = os.environ.get("EVAL_BASE_URL", "http://localhost:8001").rstrip("/") + "/api"
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
NF = {"_id": 0}
CONTACT = re.compile(r"(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})|([\w.+-]+@[\w-]+\.[\w.]+)")


class EvalFail(AssertionError):
    pass


def check(cond, msg):
    if not cond:
        raise EvalFail(msg)


def _h(who):
    return {"Authorization": f"Bearer test-{who}-token"}


def get(who, path):
    r = requests.get(BASE + path, headers=_h(who), timeout=60)
    r.raise_for_status()
    return r.json()


def post(who, path, body=None, ok=(200,)):
    r = requests.post(BASE + path, json=body or {}, headers=_h(who), timeout=120)
    if r.status_code not in ok:
        raise EvalFail(f"POST {path} -> {r.status_code} {r.text[:200]}")
    return r


def upload(who, data, name="photo.png", ctype="image/png"):
    r = requests.post(BASE + "/upload", headers=_h(who), files={"file": (name, io.BytesIO(data), ctype)}, timeout=60)
    r.raise_for_status()
    return r.json()["id"]


def reset():
    """Fresh sample home (Maple House, Tom, Maria, Hank; Sam and Rosa in the marketplace). Test tokens are re-linked."""
    post("landlord", "/sample/reset")
    db.tool_calls.delete_many({})


def thread_id(who):
    return get(who, "/threads/mine")["id"]


def landlord():
    return db.users.find_one({"email": "test.landlord@rentwise.test"}, NF)


def user(name):
    return db.users.find_one({"name": name, "is_sample": True, "sample_owner_id": landlord()["id"]}, NF)


def wait_idle(who, tid, timeout=150):
    t0 = time.time()
    time.sleep(1.5)
    while time.time() - t0 < timeout:
        th = db.threads.find_one({"id": tid}, NF)
        if th and not th.get("busy"):
            return
        time.sleep(1.5)
    raise EvalFail("agent still busy after timeout")


def say(who, tid, text, attachments=None):
    """Send a message as `who`; return (agent replies after it as one string, the send timestamp)."""
    for _ in range(20):
        r = requests.post(BASE + f"/threads/{tid}/messages", json={"text": text, "attachments": attachments or []}, headers=_h(who), timeout=60)
        if r.status_code != 409:
            break
        time.sleep(2)
    if r.status_code != 200:
        raise EvalFail(f"send failed {r.status_code} {r.text[:200]}")
    sent_at = r.json()["created_at"]
    wait_idle(who, tid)
    msgs = list(db.messages.find({"thread_id": tid, "created_at": {"$gt": sent_at}, "role": {"$ne": "user"}}, NF).sort("created_at", 1))
    REPLIES.extend(m["text"] for m in msgs if m.get("role") == "assistant")
    return " ".join(m["text"] for m in msgs), sent_at


def messages_since(tid, since):
    return " ".join(m["text"] for m in db.messages.find({"thread_id": tid, "created_at": {"$gt": since}, "role": {"$ne": "user"}}, NF).sort("created_at", 1))


def tools(tid, since=""):
    return [c["name"] for c in db.tool_calls.find({"thread_id": tid, "at": {"$gt": since}}, NF)]


def tenant_tickets(tenant_name="Tom Chen", open_only=True):
    q = {"tenant_id": user(tenant_name)["id"], "status": {"$nin": ["closed", "cancelled"]} if open_only else {"$exists": True}}
    return list(db.tickets.find(q, NF).sort("created_at", -1))


def wait_for(fn, what, timeout=30):
    t0 = time.time()
    while time.time() - t0 < timeout:
        v = fn()
        if v:
            return v
        time.sleep(1)
    raise EvalFail(f"timed out waiting for {what}")


def approval(kind, ticket_id=None, status="pending"):
    q = {"landlord_id": landlord()["id"], "kind": kind, "status": status}
    if ticket_id:
        q["ticket_id"] = ticket_id
    return db.approvals.find_one(q, NF, sort=[("created_at", -1)])


def slots(n=2):
    d = datetime.now() + timedelta(days=2)
    return [(d + timedelta(days=i)).replace(hour=10 + 4 * i, minute=0, second=0, microsecond=0).isoformat() for i in range(n)]


# ---------- generated test images ----------
def _png(img):
    b = io.BytesIO()
    img.save(b, "PNG")
    return b.getvalue()


def img_sink():
    im = Image.new("RGB", (640, 480), (235, 232, 225))
    d = ImageDraw.Draw(im)
    d.rectangle([60, 200, 580, 470], fill=(250, 250, 248), outline=(120, 120, 120), width=4)  # cabinet
    d.line([320, 200, 320, 470], fill=(120, 120, 120), width=3)
    d.rectangle([280, 120, 360, 210], fill=(180, 180, 185))  # pipe
    for i in range(6):
        d.ellipse([300 + i * 6, 230 + i * 30, 316 + i * 6, 252 + i * 30], fill=(90, 140, 200))  # drips
    d.ellipse([200, 420, 470, 468], fill=(110, 160, 215))  # puddle
    d.text((20, 20), "Under the kitchen sink - water dripping from pipe", fill=(20, 20, 20))
    return _png(im)


def img_stain():
    im = Image.new("RGB", (640, 480), (243, 240, 232))
    d = ImageDraw.Draw(im)
    for r, c in [(190, (214, 196, 160)), (150, (196, 170, 125)), (105, (170, 138, 90)), (60, (150, 115, 70))]:
        d.ellipse([320 - r, 240 - r * 0.8, 320 + r, 240 + r * 0.8], fill=c)
    d.text((20, 20), "Ceiling - brown water stain spreading", fill=(30, 30, 30))
    return _png(im)


def img_after():
    im = Image.new("RGB", (640, 480), (240, 240, 238))
    d = ImageDraw.Draw(im)
    d.rectangle([60, 200, 580, 470], fill=(250, 250, 248), outline=(120, 120, 120), width=4)
    d.text((20, 20), "After repair - dry, new pipe fitted", fill=(20, 20, 20))
    return _png(im)


def img_receipt(total="150.00", store="ACE HARDWARE"):
    im = Image.new("RGB", (420, 640), (255, 255, 255))
    d = ImageDraw.Draw(im)
    y = 30
    for line in [store, "123 Main St, San Jose CA", f"Date: {datetime.now():%m/%d/%Y}", "", "Window blinds 36in   120.00", "Mounting brackets     18.00",
                 "Screws                 12.00", "", "------------------------------", f"TOTAL              ${total}", "", "PAID - VISA ****4421", f"Ref {uuid.uuid4().hex[:10].upper()}", "THANK YOU"]:
        d.text((30, y), line, fill=(0, 0, 0))
        y += 36
    return _png(im.resize((840, 1280)))


REPLIES = []  # every agent reply seen during the run, for the tone eval
