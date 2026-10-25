"""Move-in / move-out inspections, AI comparison (Jev screens, Sonnet reviews) and deposit statements."""
import asyncio, base64, hashlib, io, json, math, os, re, subprocess, tempfile
from datetime import datetime, timedelta
from pathlib import Path
import httpx, imagehash
from PIL import Image
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
from core import (db, NF, uid, iso, now, get_user, get_media_user, need, money, first, put_object, read_file, tenant_thread, post, activity,
                  LLM_KEY, APP_NAME, SONNET, log)
from data import STATE_RULES, pdf_bytes

router = APIRouter(prefix="/api")

# ---------- tunables ----------
SAME_VIEW_MIN = 0.5        # below: views don't match -> landlord check, no Sonnet
NEW_DAMAGE_MAX = 0.2       # below (and confident benign kind): skip Sonnet
KIND_CONF_MIN = 0.7
PHASH_CHANGE = 8           # safety net: frames this different never skip Sonnet, even if Jev saw no change
SONNET_CONF_MIN = 0.6      # below: becomes "check"
FRAME_EVERY_S = 2
MAX_FRAMES = 15
PHASH_DUP = 6
MAX_PAIRS = 10
FRAME_LONG_SIDE = 1024
JEV_MIN_PX, JEV_MAX_PX = 280, 1568
VIDEO_MAX_S = 45
VIDEO_MAX_MB = 100
JEV_PARALLEL, SONNET_PARALLEL = 5, 3
DEFAULT_AREAS = ["Entry", "Living room", "Kitchen", "Bedroom", "Bathroom", "Windows & blinds", "Floors", "Appliances"]
CATS = ("damage", "normal_wear", "pre_existing", "reported_repair", "check")
FIXED = {"normal_wear": "Normal wear from everyday living. This can't be charged.",
         "pre_existing": "Already visible in the move-in record, so it isn't charged.",
         "check": "These views don't match; landlord should look."}


def key_of(label):
    return re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:30] or uid()[:6]


# ---------- images / frames ----------
def prep_image(data):
    """Resize to FRAME_LONG_SIDE on the long side, JPEG. Returns (jpeg_bytes, phash_str, (w, h))."""
    im = Image.open(io.BytesIO(data)).convert("RGB")
    im.thumbnail((FRAME_LONG_SIDE, FRAME_LONG_SIDE))
    b = io.BytesIO()
    im.save(b, "JPEG", quality=82)
    return b.getvalue(), str(imagehash.phash(im)), im.size


def jev_sized(size):
    return all(JEV_MIN_PX <= s <= JEV_MAX_PX for s in size)


def phash_dist(a, b):
    return imagehash.hex_to_hash(a) - imagehash.hex_to_hash(b)


def video_duration(path):
    import imageio_ffmpeg
    return imageio_ffmpeg.count_frames_and_secs(path)[1]


def extract_frames(data, ext="mp4"):
    """1 frame every FRAME_EVERY_S seconds, at most MAX_FRAMES, near-duplicates (phash < PHASH_DUP) dropped.
    Returns (duration_s, [{t_seconds, jpeg, phash, size}])."""
    import imageio_ffmpeg
    with tempfile.TemporaryDirectory() as d:
        src = Path(d) / f"in.{ext}"
        src.write_bytes(data)
        dur = video_duration(str(src))
        if dur > VIDEO_MAX_S + 0.5:
            raise ValueError(f"That video is {int(dur)} seconds. Please keep it under {VIDEO_MAX_S} seconds")
        subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-loglevel", "error", "-i", str(src), "-vf", f"fps=1/{FRAME_EVERY_S}",
                        "-frames:v", str(MAX_FRAMES), str(Path(d) / "f%03d.jpg")], check=True, timeout=120)
        out = []
        for i, f in enumerate(sorted(Path(d).glob("f*.jpg"))):
            jpeg, ph, size = prep_image(f.read_bytes())
            if any(phash_dist(ph, o["phash"]) < PHASH_DUP for o in out):
                continue
            out.append({"t_seconds": i * FRAME_EVERY_S, "jpeg": jpeg, "phash": ph, "size": size})
        return dur, out[:MAX_FRAMES]


async def save_frame(owner_id, insp_id, jpeg):
    fid = uid()
    path = f"{APP_NAME}/frames/{insp_id}/{fid}.jpg"
    res = await asyncio.to_thread(put_object, path, jpeg, "image/jpeg")
    await db.files.insert_one({"id": fid, "path": res.get("path", path), "owner_id": owner_id, "content_type": "image/jpeg",
                               "hash": hashlib.sha256(jpeg).hexdigest(), "ticket_id": None, "inspection_id": insp_id, "created_at": iso()})
    return fid


# ---------- access ----------
async def access(insp_or_stmt, user, write_tenant=False):
    if user.get("role") == "handyman":
        raise HTTPException(403, "This screen isn't available for your account")
    ids = (insp_or_stmt["tenant_id"], insp_or_stmt["landlord_id"])
    if user["id"] not in ids and user.get("acting_by") != insp_or_stmt["landlord_id"]:
        raise HTTPException(404, "Not found")
    if write_tenant and user["id"] != insp_or_stmt["tenant_id"]:
        raise HTTPException(403, "Only the tenant can do this step")


async def get_insp(iid, user, write_tenant=False):
    i = await db.inspections.find_one({"id": iid}, NF)
    if not i:
        raise HTTPException(404, "Not found")
    await access(i, user, write_tenant)
    return i


async def move(iid, frm, to, extra=None):
    frm = [frm] if isinstance(frm, str) else frm
    r = await db.inspections.find_one_and_update({"id": iid, "status": {"$in": frm}, "locked_at": None}, {"$set": {"status": to, **(extra or {})}},
                                                 projection=NF, return_document=True)
    if not r:
        raise HTTPException(409, "This check can't be changed now")
    return r


def report_hash(insp):
    parts = []
    for a in insp["areas"]:
        parts += [a["key"], (a.get("video") or {}).get("sha256", "")] + [p["sha256"] for p in a.get("photos") or []] + [a.get("tenant_note") or "", a.get("ai_note") or ""]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()


def new_inspection(unit, kind, labels, extra=None):
    return {"id": uid(), "unit_id": unit["id"], "property_id": unit["property_id"], "landlord_id": unit["landlord_id"], "tenant_id": unit["tenant_id"],
            "kind": kind, "status": "in_progress", "areas": [{"key": key_of(l), "label": l, "video": None, "photos": [], "frames": [], "tenant_note": "", "ai_note": ""} for l in labels],
            "created_at": iso(), "submitted_at": None, "completed_at": None, "locked_at": None, "report_hash": None, "progress": {},
            "stats": {"pairs_screened": 0, "sent_to_sonnet": 0, "jev_calls": 0, "sonnet_calls": 0, "jev_tokens": 0, "sonnet_tokens": 0}, **(extra or {})}


# ---------- statement maths & validation ----------
def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) and f >= 0 else None


def valid_box(b):
    try:
        l, t, r, bt = (float(b[k]) for k in ("left", "top", "right", "bottom"))
    except (TypeError, KeyError, ValueError):
        return None
    if not all(0 <= v <= 1 for v in (l, t, r, bt)) or l >= r or t >= bt:
        return None
    return {"left": l, "top": t, "right": r, "bottom": bt}


def validate_item(raw, area_key, mi_frame=None, mo_frame=None, jev=None, source="ai"):
    """Server-side rules applied to every AI finding (6e)."""
    cat = raw.get("category") if raw.get("category") in CATS else "check"
    charge = _num(raw.get("suggested_charge", raw.get("charge", 0)) or 0)
    low, high = _num(raw.get("estimate_low") or 0), _num(raw.get("estimate_high") or 0)
    conf = _num(raw.get("confidence"))
    if charge is None or (cat == "damage" and conf is not None and conf < SONNET_CONF_MIN and source == "ai"):
        cat, charge = "check", 0
    if cat != "damage":
        charge = 0
    expl = " ".join(str(raw.get("explanation") or FIXED.get(cat, "")).split()[:25])
    sev = raw.get("severity")
    sev = int(round(sev)) if isinstance(sev, (int, float)) and 1 <= sev <= 5 else None
    return {"id": uid(), "area_key": area_key, "category": cat, "title": str(raw.get("title") or cat.replace("_", " ").capitalize())[:80], "explanation": expl,
            "charge": int(round(charge)), "estimate_low": int(round(low or 0)), "estimate_high": int(round(high or 0)), "severity": sev,
            "box": valid_box(raw.get("box")) if raw.get("box") else None, "move_in_frame_id": mi_frame, "move_out_frame_id": mo_frame,
            "source": source, "removed": False, "jev": jev, "disputed": False}


def _overlap(a, b):
    if not a or not b:
        return 0
    w = min(a["right"], b["right"]) - max(a["left"], b["left"])
    h = min(a["bottom"], b["bottom"]) - max(a["top"], b["top"])
    if w <= 0 or h <= 0:
        return 0
    small = min((a["right"] - a["left"]) * (a["bottom"] - a["top"]), (b["right"] - b["left"]) * (b["bottom"] - b["top"]))
    return w * h / small


def merge_items(items):
    out = []
    for it in sorted(items, key=lambda x: -x["charge"]):
        if any(o["area_key"] == it["area_key"] and o["category"] == it["category"]
               and (_overlap(o["box"], it["box"]) > 0.5 or (not o["box"] and not it["box"] and it["category"] != "damage")) for o in out):
            continue
        out.append(it)
    return out


def recompute(st):
    dmg = sum(i["charge"] for i in st["items"] if i["category"] == "damage" and not i["removed"])
    dep = float(st["deposit"] or 0)
    st["total_deductions"] = min(dmg, dep)
    st["refund"] = dep - st["total_deductions"]
    st["over_deposit"] = max(0, dmg - dep)
    return st


# ---------- models ----------
def _data_url(jpeg):
    return "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()


JEV_QS = {
    "same_view": {"type": "noul", "instructions": "Do move_in and move_out show the same part of the room from a similar angle?"},
    "new_damage": {"type": "noul", "instructions": "Does move_out show damage that is not visible in move_in, such as burns, holes larger than a nail hole, cracks, broken fixtures, or large stains?"},
    "kind": {"type": "choice", "instructions": "What best describes the change from move_in to move_out?", "criteria": {
        "none": "no visible change", "normal_wear": "small nail holes, light scuffs, slightly faded paint, normal carpet wear",
        "damage": "new damage beyond normal wear", "pre_existing": "the issue is already visible in move_in or described in move_in_notes",
        "reported_repair": "matches an item in unit_tickets that the tenant reported"}},
    "severity": {"type": "score", "instructions": "How severe is the newly visible issue in move_out?", "criteria": [
        "cosmetic and barely visible", "visible but minor, a touch-up", "clearly visible, needs a repair visit",
        "significant: replacement of a part or surface", "major: unsafe, or a large area"]},
}


def _shrink(jpeg, side):
    im = Image.open(io.BytesIO(jpeg))
    im.thumbnail((side, side))
    b = io.BytesIO()
    im.save(b, "JPEG", quality=70)
    return b.getvalue()


JEV_SIDES = (1024, 640, 512)  # detailed photos can exceed Jev's token budget; retry smaller (never below JEV_MIN_PX)


async def jev_screen(mi_jpeg, mo_jpeg, area, notes, tickets):
    proxy = (os.environ.get("INTEGRATION_PROXY_URL") or "https://integrations.emergentagent.com").rstrip("/")
    async with httpx.AsyncClient(timeout=30) as c:
        for side in JEV_SIDES:
            a, b = (mi_jpeg, mo_jpeg) if side == JEV_SIDES[0] else (_shrink(mi_jpeg, side), _shrink(mo_jpeg, side))
            if not all(jev_sized(Image.open(io.BytesIO(x)).size) for x in (a, b)):
                break
            body = {"model": "jev-latest", "questions": JEV_QS,
                    "state": {"move_in": _data_url(a), "move_out": _data_url(b), "area": area, "move_in_notes": notes, "unit_tickets": tickets}}
            r = await c.post(f"{proxy}/llm/typesafe/v1/systemone", json=body, headers={"Authorization": f"Bearer {LLM_KEY}", "TypeSafe-Danger-Zone-Images": "true"})
            if r.status_code == 400 and "max_tokens_exceeded" in r.text:
                continue
            r.raise_for_status()
            d = r.json()
            ans = d["answers"]
            sev = ans["severity"]["probabilities"]
            return {"same_view": ans["same_view"]["noul"], "new_damage": ans["new_damage"]["noul"], "kind": ans["kind"]["choice"],
                    "kind_confidence": ans["kind"].get("confidence", 0), "severity": int(max(sev, key=sev.get)) + 1,
                    "tokens": (d.get("usage") or {}).get("input_tokens", 0), "jev_side": side}
    raise RuntimeError("Jev: images too detailed at every size")


SONNET_SYS = """You compare a move-in and a move-out photo of the same part of a rental home for a US landlord's deposit statement.
Return ONLY JSON: {"category": "damage|normal_wear|pre_existing|reported_repair|check", "title": "...", "explanation": "plain words, max 25",
"estimate_low": 0, "estimate_high": 0, "suggested_charge": 0, "confidence": 0.0, "severity": 1-5, "box": {"left":0-1,"top":0-1,"right":0-1,"bottom":0-1} or null}
Rules: only damage may have suggested_charge > 0. Normal wear is $0 and cites the state's rule. Anything visible in the move-in photo or notes is pre_existing, $0.
Anything matching a ticket the tenant reported is reported_repair, $0. If unsure (confidence < 0.6) use check, $0. Never invent damage that isn't visible.
box marks the newly damaged area on the move-out photo (fractions of width/height). Price from the landlord's past repair costs when given."""


async def sonnet_review(mi_jpeg, mo_jpeg, ctx):
    chat = LlmChat(api_key=LLM_KEY, session_id=uid(), system_message=SONNET_SYS).with_model("anthropic", SONNET)
    msg = UserMessage(text="First image: move-in. Second image: move-out.\n" + json.dumps(ctx, default=str)[:6000],
                      file_contents=[ImageContent(base64.b64encode(mi_jpeg).decode()), ImageContent(base64.b64encode(mo_jpeg).decode())])
    raw = await chat.send_message(msg)
    raw = raw if isinstance(raw, str) else getattr(raw, "content", str(raw))
    m = re.search(r"\{.*\}", raw or "", re.S)
    return json.loads(m.group(0)) if m else {"category": "check"}, raw


def route(j, dist=0):
    """6c: returns ("none"|"item"|"sonnet", raw_item_or_None). dist = phash distance between the two frames."""
    if j is None:
        return "sonnet", None
    if j["same_view"] < SAME_VIEW_MIN:
        return "item", {"category": "check", "title": "Views don't match", "explanation": FIXED["check"]}
    if j["new_damage"] < NEW_DAMAGE_MAX and j["kind"] in ("none", "normal_wear", "pre_existing") and j["kind_confidence"] >= KIND_CONF_MIN and dist < PHASH_CHANGE:
        if j["kind"] == "none":
            return "none", None
        return "item", {"category": j["kind"], "title": "Normal wear" if j["kind"] == "normal_wear" else "Already there at move-in", "explanation": FIXED[j["kind"]], "severity": j["severity"]}
    return "sonnet", None


async def screen_pairs(pairs, jev_fn, sonnet_fn, ctx_base, stats):
    """pairs: [{area_key, area, notes, mi:{id,jpeg}, mo:{id,jpeg,size}}]. Pure of DB so tests can pass fakes."""
    js, ss = asyncio.Semaphore(JEV_PARALLEL), asyncio.Semaphore(SONNET_PARALLEL)
    raws = []

    async def one(p):
        j = None
        if jev_sized(p["mo"]["size"]) and jev_sized(p["mi"]["size"]):
            async with js:
                try:
                    stats["jev_calls"] += 1
                    j = await jev_fn(p["mi"]["jpeg"], p["mo"]["jpeg"], p["area"], p["notes"], ctx_base.get("tickets", []))
                    stats["jev_tokens"] += j.get("tokens", 0)
                except Exception as e:  # noqa: BLE001  Jev never fails the analysis
                    log.warning("jev failed %s", e)
                    j = None
        stats["pairs_screened"] += 1
        kind, raw = route(j, p.get("dist", 0))
        if kind == "none":
            return None
        if kind == "sonnet":
            stats["sent_to_sonnet"] += 1
            async with ss:
                try:
                    stats["sonnet_calls"] += 1
                    raw, text = await sonnet_fn(p["mi"]["jpeg"], p["mo"]["jpeg"], {**ctx_base, "area": p["area"], "move_in_notes": p["notes"], "jev": j})
                    raws.append(text)
                except Exception as e:  # noqa: BLE001
                    log.warning("sonnet failed %s", e)
                    raw = {"category": "check", "title": "Couldn't compare", "explanation": "Landlord should check this view."}
        return validate_item(raw, p["area_key"], p["mi"]["id"], p["mo"]["id"], j)

    items = [i for i in await asyncio.gather(*(one(p) for p in pairs)) if i]
    return merge_items(items), raws


# ---------- analysis orchestration ----------
async def _frame_bytes(fid):
    data, _ = await read_file(fid)
    jpeg, ph, size = await asyncio.to_thread(prep_image, data)
    return jpeg, size


async def area_notes(insp):
    """Move-in: Sonnet writes a short ai_note per area from up to 4 frames."""
    for a in insp["areas"]:
        frames = a.get("frames") or []
        if not frames:
            continue
        try:
            imgs = [ImageContent(base64.b64encode((await _frame_bytes(f["file_id"]))[0]).decode()) for f in frames[:: max(1, len(frames) // 4)][:4]]
            chat = LlmChat(api_key=LLM_KEY, session_id=uid(), system_message="You note visible existing issues in a rental home's move-in photos. Reply in at most 20 plain words, e.g. 'small stain near the window, scuff on the door frame'. If nothing is visible, reply 'No visible issues'.").with_model("anthropic", SONNET)
            note = await chat.send_message(UserMessage(text=f"Area: {a['label']}", file_contents=imgs))
            note = (note if isinstance(note, str) else str(note)).strip()[:200]
        except Exception as e:  # noqa: BLE001
            log.warning("area note failed %s", e)
            note = ""
        await db.inspections.update_one({"id": insp["id"], "locked_at": None, "areas.key": a["key"]}, {"$set": {"areas.$.ai_note": note}})
    await db.inspections.update_one({"id": insp["id"]}, {"$set": {"notes_ready": True}})


async def deposit_for(unit):
    p = await db.payments.find_one({"unit_id": unit["id"], "tenant_id": unit["tenant_id"], "kind": "deposit", "status": "recorded"}, NF)
    if p:
        return float(p["amount"])
    le = await db.leases.find_one({"unit_id": unit["id"], "status": "signed"}, NF, sort=[("created_at", -1)])
    return float((le or {}).get("terms", {}).get("deposit") or 0)


async def analyze(iid, jev_fn=None, sonnet_fn=None):
    mo = await db.inspections.find_one({"id": iid}, NF)
    try:
        mi = await db.inspections.find_one({"id": mo.get("move_in_id"), "status": "confirmed"}, NF) if mo.get("move_in_id") else None
        unit = await db.units.find_one({"id": mo["unit_id"]}, NF)
        prop = await db.properties.find_one({"id": mo["property_id"]}, NF)
        tickets = [{"title": t["title"], "date": t["created_at"][:10], "reported_by": "tenant", "status": t["status"]}
                   async for t in db.tickets.find({"unit_id": unit["id"], "tenant_id": mo["tenant_id"]}, NF)]
        exps = [f"{e['description']} {money(e['amount'])}" async for e in db.expenses.find({"landlord_id": mo["landlord_id"], "category": "Repairs"}, NF).limit(15)]
        rules = STATE_RULES.get(prop["state"], {})
        ctx = {"tickets": tickets, "state": {"name": rules.get("name"), "deposit_limit": rules.get("deposit_limit"), "notes": rules.get("notes")}, "past_repair_costs": exps}
        stats = dict(mo["stats"])
        items, raws = [], []
        for a in mo["areas"]:
            await db.inspections.update_one({"id": iid}, {"$set": {f"progress.{a['key']}": "working"}})
            mia = next((x for x in (mi or {}).get("areas", []) if x["key"] == a["key"]), None)
            if not mia or not mia.get("frames"):
                if a.get("frames"):
                    items.append(validate_item({"category": "check", "title": "No move-in record", "explanation": "No locked move-in record to compare. Landlord should check this."}, a["key"], None, a["frames"][0]["file_id"]))
                await db.inspections.update_one({"id": iid}, {"$set": {f"progress.{a['key']}": "done"}})
                continue
            notes = " ".join(x for x in (mia.get("tenant_note"), mia.get("ai_note")) if x)
            pairs = []
            for f in a.get("frames") or []:
                best = min(mia["frames"], key=lambda m: phash_dist(m["phash"], f["phash"]))
                pairs.append((phash_dist(best["phash"], f["phash"]), f, best))
            pairs = sorted(pairs, key=lambda x: x[0])[:MAX_PAIRS]
            prepared = []
            for dist, f, b in pairs:
                mo_j, mo_s = await _frame_bytes(f["file_id"])
                mi_j, mi_s = await _frame_bytes(b["file_id"])
                prepared.append({"area_key": a["key"], "area": a["label"], "notes": notes, "dist": dist, "mi": {"id": b["file_id"], "jpeg": mi_j, "size": mi_s}, "mo": {"id": f["file_id"], "jpeg": mo_j, "size": mo_s}})
            got, r = await screen_pairs(prepared, jev_fn or jev_screen, sonnet_fn or sonnet_review, ctx, stats)
            items += got
            raws += r
            await db.inspections.update_one({"id": iid}, {"$set": {f"progress.{a['key']}": "done"}})
        st = {"id": uid(), "unit_id": unit["id"], "tenant_id": mo["tenant_id"], "landlord_id": mo["landlord_id"], "property_id": prop["id"],
              "move_in_id": (mi or {}).get("id"), "move_out_id": iid, "deposit": await deposit_for(unit), "items": items, "status": "draft",
              "due_by": mo["due_by"], "state": prop["state"], "version": 1, "created_at": iso(), "approved_at": None, "raw_model_output": raws, "stats": stats}
        recompute(st)
        await db.deposit_statements.insert_one(dict(st))
        await db.inspections.update_one({"id": iid}, {"$set": {"status": "analyzed", "completed_at": iso(), "stats": stats, "statement_id": st["id"]}})
        import flows
        tn = await db.users.find_one({"id": mo["tenant_id"]}, NF)
        await flows.create_approval(mo["landlord_id"], "deposit_statement", st["refund"], tenant_id=mo["tenant_id"], title=f"Review {first(tn['name'])}'s deposit statement",
                                    reason=f"Refund {money(st['refund'])} of {money(st['deposit'])}. Due by {st['due_by']}.",
                                    recommendation="✦ Check the charges, edit anything, then approve.", extra={"statement_id": st["id"]})
        need_review = sum(1 for i in items if i["category"] in ("damage", "check"))
        await activity(mo["landlord_id"], f"Doorman compared {unit['label']}: {stats['pairs_screened']} views checked, {need_review} need your review.", None, "system")
    except Exception as e:  # noqa: BLE001
        log.exception("analysis failed")
        await db.inspections.update_one({"id": iid}, {"$set": {"status": "submitted", "error": str(e)[:200]}})


# ---------- inspection routes ----------
def _summary(i):
    return {"id": i["id"], "kind": i["kind"], "status": i["status"], "locked": bool(i.get("locked_at")), "areas": len(i["areas"]),
            "statement_id": i.get("statement_id"), "due_by": i.get("due_by"), "move_out_date": i.get("move_out_date")}


async def latest(unit_id, kind, tenant_id=None):
    q = {"unit_id": unit_id, "kind": kind}
    if tenant_id:
        q["tenant_id"] = tenant_id
    return await db.inspections.find_one(q, NF, sort=[("created_at", -1)])


@router.get("/inspections/mine")
async def my_inspections(user=Depends(get_user)):
    need(user, "tenant")
    unit = await db.units.find_one({"tenant_id": user["id"]}, NF)
    if not unit:
        return {"move_in": None, "move_out": None, "statement": None}
    mi, mo = await latest(unit["id"], "move_in", user["id"]), await latest(unit["id"], "move_out", user["id"])
    st = await db.deposit_statements.find_one({"tenant_id": user["id"], "status": "sent"}, NF, sort=[("created_at", -1)])
    return {"move_in": _summary(mi) if mi else None, "move_out": _summary(mo) if mo else None,
            "statement": {"id": st["id"], "refund": st["refund"], "total_deductions": st["total_deductions"]} if st else None}


@router.put("/units/{unit_id}/inspection-areas")
async def set_areas(unit_id: str, body: dict, user=Depends(get_user)):
    need(user, "landlord")
    unit = await db.units.find_one({"id": unit_id, "landlord_id": user["id"]}, NF)
    if not unit:
        raise HTTPException(404, "Room not found")
    if unit.get("tenant_id") and await latest(unit_id, "move_in", unit["tenant_id"]):
        raise HTTPException(409, "The move-in check has started, so areas can't change")
    labels = [str(x).strip()[:30] for x in body.get("labels") or [] if str(x).strip()]
    if not labels or len({key_of(x) for x in labels}) != len(labels):
        raise HTTPException(400, "Add at least one area, each with a different name")
    await db.units.update_one({"id": unit_id}, {"$set": {"inspection_areas": labels[:15]}})
    return {"labels": labels[:15]}


@router.post("/inspections/move-in")
async def start_move_in(user=Depends(get_user)):
    need(user, "tenant")
    unit = await db.units.find_one({"tenant_id": user["id"]}, NF)
    if not unit:
        raise HTTPException(404, "No home linked yet")
    ex = await latest(unit["id"], "move_in", user["id"])
    if ex:
        return ex
    i = new_inspection(unit, "move_in", unit.get("inspection_areas") or DEFAULT_AREAS)
    await db.inspections.insert_one(dict(i))
    i.pop("_id", None)
    return i


async def create_move_out(unit, landlord_id, date_str=None):
    if not unit.get("tenant_id"):
        raise HTTPException(400, "No tenant in this room")
    if await db.inspections.find_one({"unit_id": unit["id"], "tenant_id": unit["tenant_id"], "kind": "move_out"}):
        raise HTTPException(409, "A move-out check already exists for this tenant")
    d = (date_str or now().date().isoformat())[:10]
    try:
        datetime.fromisoformat(d)
    except ValueError:
        raise HTTPException(400, "Pick a valid move-out date")
    prop = await db.properties.find_one({"id": unit["property_id"]}, NF)
    days = (STATE_RULES.get(prop["state"]) or {}).get("deposit_return_days") or 30
    mi = await db.inspections.find_one({"unit_id": unit["id"], "tenant_id": unit["tenant_id"], "kind": "move_in", "status": "confirmed"}, NF)
    labels = [a["label"] for a in mi["areas"]] if mi else (unit.get("inspection_areas") or DEFAULT_AREAS)
    i = new_inspection(unit, "move_out", labels, {"move_in_id": mi["id"] if mi else None, "move_out_date": d, "return_days": days,
                                                  "due_by": (datetime.fromisoformat(d) + timedelta(days=days)).date().isoformat()})
    await db.inspections.insert_one(dict(i))
    i.pop("_id", None)
    tn = await db.users.find_one({"id": unit["tenant_id"]}, NF)
    th = await tenant_thread(unit["tenant_id"], landlord_id)
    await post(th["id"], f"Your move-out is set for {d}. Please do the move-out check before you hand back the keys — it's the same walk-through as move-in.",
               cards=[{"type": "inspection", "inspection_id": i["id"]}])
    await activity(landlord_id, f"Move-out started for {first(tn['name'])} · {unit['label']} (refund due by {i['due_by']})", None, "system")
    return i


@router.post("/units/{unit_id}/move-out")
async def start_move_out(unit_id: str, body: dict, user=Depends(get_user)):
    need(user, "landlord")
    unit = await db.units.find_one({"id": unit_id, "landlord_id": user["id"]}, NF)
    if not unit:
        raise HTTPException(404, "Room not found")
    return await create_move_out(unit, user["id"], body.get("move_out_date"))


@router.get("/inspections/{iid}")
async def get_inspection(iid: str, user=Depends(get_user)):
    i = await get_insp(iid, user)
    if i["kind"] == "move_out" and i.get("move_in_id"):
        mi = await db.inspections.find_one({"id": i["move_in_id"]}, NF)
        i["reference"] = {a["key"]: (a.get("frames") or [{}])[0].get("file_id") for a in mi["areas"]}
        i["move_in_created_at"] = mi["created_at"]
    unit = await db.units.find_one({"id": i["unit_id"]}, NF)
    tn = await db.users.find_one({"id": i["tenant_id"]}, NF)
    i["unit_label"], i["tenant_name"] = unit["label"], tn["name"] if tn else ""
    return i


@router.post("/inspections/{iid}/areas/{key}/media")
async def add_media(iid: str, key: str, body: dict, user=Depends(get_user)):
    i = await get_insp(iid, user, write_tenant=True)
    if i["status"] != "in_progress" or i.get("locked_at"):
        raise HTTPException(409, "This check can't be changed now")
    area = next((a for a in i["areas"] if a["key"] == key), None)
    f = await db.files.find_one({"id": body.get("file_id"), "owner_id": user["id"]}, NF)
    if not area or not f:
        raise HTTPException(404, "Not found")
    data, _ = await read_file(f["id"])
    is_video = (f["content_type"] or "").startswith("video/") or f["path"].rsplit(".", 1)[-1] in ("mp4", "mov")
    if is_video:
        if len(data) > VIDEO_MAX_MB * 1024 * 1024:
            raise HTTPException(413, f"That video is too big. Please keep it under {VIDEO_MAX_MB} MB")
        try:
            dur, frames = await asyncio.to_thread(extract_frames, data, f["path"].rsplit(".", 1)[-1])
        except ValueError as e:
            raise HTTPException(400, str(e))
        except Exception:  # noqa: BLE001
            raise HTTPException(422, "I couldn't read that video. Please record it again")
        saved = [{"file_id": await save_frame(user["id"], iid, fr["jpeg"]), "t_seconds": fr["t_seconds"], "phash": fr["phash"]} for fr in frames]
        upd = {"areas.$.video": {"file_id": f["id"], "sha256": f["hash"], "duration_s": round(dur, 1)}, "areas.$.frames": saved, "areas.$.photos": []}
    else:
        if len(area.get("photos") or []) >= 4 or area.get("video"):
            raise HTTPException(400, "Up to 4 photos per area")
        jpeg, ph, _ = await asyncio.to_thread(prep_image, data)
        fr = {"file_id": await save_frame(user["id"], iid, jpeg), "t_seconds": 0, "phash": ph}
        photos = (area.get("photos") or []) + [{"file_id": f["id"], "sha256": f["hash"], "taken_at": iso()}]
        upd = {"areas.$.photos": photos, "areas.$.frames": (area.get("frames") or []) + [fr]}
    await db.files.update_one({"id": f["id"]}, {"$set": {"inspection_id": iid}})
    r = await db.inspections.find_one_and_update({"id": iid, "status": "in_progress", "locked_at": None, "areas.key": key}, {"$set": upd}, projection=NF, return_document=True)
    if not r:
        raise HTTPException(409, "This check can't be changed now")
    return next(a for a in r["areas"] if a["key"] == key)


@router.put("/inspections/{iid}/areas/{key}/note")
async def set_note(iid: str, key: str, body: dict, user=Depends(get_user)):
    await get_insp(iid, user, write_tenant=True)
    r = await db.inspections.find_one_and_update({"id": iid, "status": {"$in": ["in_progress", "submitted"]}, "locked_at": None, "areas.key": key},
                                                 {"$set": {"areas.$.tenant_note": str(body.get("note") or "")[:300]}}, projection=NF, return_document=True)
    if not r:
        raise HTTPException(409, "This check can't be changed now")
    return {"ok": True}


@router.post("/inspections/{iid}/submit")
async def submit(iid: str, user=Depends(get_user)):
    i = await get_insp(iid, user, write_tenant=True)
    if not any(a.get("frames") for a in i["areas"]):
        raise HTTPException(400, "Record at least one area first")
    if i["kind"] == "move_in":
        r = await move(iid, "in_progress", "submitted", {"submitted_at": iso(), "notes_ready": False})
        asyncio.create_task(area_notes(r))
    else:
        r = await move(iid, ["in_progress", "submitted"], "analyzing", {"submitted_at": iso(), "progress": {a["key"]: "waiting" for a in i["areas"]}, "error": None})
        asyncio.create_task(analyze(iid))
    return r


@router.post("/inspections/{iid}/confirm")
async def confirm(iid: str, user=Depends(get_user)):
    i = await get_insp(iid, user, write_tenant=True)
    if i["kind"] != "move_in":
        raise HTTPException(400, "Only the move-in check is confirmed")
    r = await move(iid, "submitted", "confirmed", {"locked_at": iso(), "completed_at": iso(), "report_hash": report_hash(i)})
    unit = await db.units.find_one({"id": i["unit_id"]}, NF)
    done = sum(1 for a in i["areas"] if a.get("frames"))
    await activity(i["landlord_id"], f"{first(user['name'])} finished the move-in check for {unit['label']} ({done} areas)", None, "system")
    return r


@router.get("/move-outs")
async def move_outs(user=Depends(get_user)):
    need(user, "landlord")
    out = []
    async for i in db.inspections.find({"landlord_id": user["id"], "kind": "move_out"}, NF):
        st = await db.deposit_statements.find_one({"move_out_id": i["id"]}, NF)
        if st and st["status"] == "sent":
            continue
        unit = await db.units.find_one({"id": i["unit_id"]}, NF)
        tn = await db.users.find_one({"id": i["tenant_id"]}, NF)
        prop = await db.properties.find_one({"id": i["property_id"]}, NF)
        left = (datetime.fromisoformat(i["due_by"]).date() - now().date()).days
        out.append({"inspection_id": i["id"], "status": i["status"], "tenant_name": tn["name"] if tn else "", "unit_label": unit["label"] if unit else "",
                    "state": prop["state"], "return_days": i.get("return_days"), "due_by": i["due_by"], "days_left": left, "statement_id": st["id"] if st else None})
    return sorted(out, key=lambda x: x["days_left"])


# ---------- deposit statements ----------
async def get_stmt(sid, user):
    st = await db.deposit_statements.find_one({"id": sid}, NF)
    if not st:
        raise HTTPException(404, "Not found")
    await access(st, user)
    if user["id"] == st["tenant_id"] and st["status"] != "sent":
        raise HTTPException(404, "Not found")  # nothing reaches the tenant before the landlord approves
    return st


async def stmt_view(st):
    mo = await db.inspections.find_one({"id": st["move_out_id"]}, NF)
    mi = await db.inspections.find_one({"id": st.get("move_in_id")}, NF) if st.get("move_in_id") else None
    times = {}
    for insp in (mi, mo):
        for a in (insp or {}).get("areas", []):
            for f in a.get("frames") or []:
                times[f["file_id"]] = f["t_seconds"]
    videos = {}
    for tag, insp in (("in", mi), ("out", mo)):
        for a in (insp or {}).get("areas", []):
            if a.get("video"):
                videos[f"{tag}:{a['key']}"] = a["video"]["file_id"]
    unit = await db.units.find_one({"id": st["unit_id"]}, NF)
    tn = await db.users.find_one({"id": st["tenant_id"]}, NF)
    prop = await db.properties.find_one({"id": st["property_id"]}, NF)
    areas = {a["key"]: a["label"] for a in (mo or {}).get("areas", [])}
    return {**st, "frame_times": times, "videos": videos, "areas": areas, "unit_label": unit["label"], "tenant_name": tn["name"] if tn else "",
            "property_name": prop["name"], "move_in_date": (mi or {}).get("created_at", "")[:10], "move_out_date": (mo or {}).get("move_out_date"),
            "return_days": (mo or {}).get("return_days"), "days_left": (datetime.fromisoformat(st["due_by"]).date() - now().date()).days}


@router.get("/statements/{sid}")
async def read_statement(sid: str, user=Depends(get_user)):
    st = await get_stmt(sid, user)
    v = await stmt_view(st)
    if user["id"] == st["tenant_id"]:
        v.pop("raw_model_output", None)
        v.pop("stats", None)
        # tenants see what they're charged and what wasn't charged; landlord-only "check" items stay private
        v["items"] = [{k: val for k, val in i.items() if k not in ("jev", "source")} for i in v["items"] if not i["removed"] and i["category"] != "check"]
        for i in v["items"]:
            i["title"] = re.sub(r"^[^:]+:\s*", "", i["title"])
    return v


@router.patch("/statements/{sid}")
async def edit_statement(sid: str, body: dict, user=Depends(get_user)):
    need(user, "landlord")
    if user.get("acting_by"):
        raise HTTPException(403, "Switch back to your own view to edit money")
    st = await db.deposit_statements.find_one({"id": sid, "landlord_id": user["id"]}, NF)
    if not st:
        raise HTTPException(404, "Not found")
    if st["status"] != "draft":
        raise HTTPException(409, "This statement was already sent")
    if body.get("version") != st["version"]:
        raise HTTPException(409, "Updated elsewhere, pull to refresh")
    op = body.get("op")
    items = st["items"]
    it = next((i for i in items if i["id"] == body.get("item_id")), None)
    if op != "add" and not it:
        raise HTTPException(404, "Item not found")
    if op == "price":
        c = _num(body.get("charge"))
        if c is None:
            raise HTTPException(400, "Enter a price of $0 or more")
        if it["category"] != "damage":
            raise HTTPException(400, "Move it to Charge first")
        it["charge"] = int(round(c))
    elif op in ("remove", "undo"):
        it["removed"] = op == "remove"
    elif op == "category":
        cat = body.get("category")
        if cat not in CATS:
            raise HTTPException(400, "Pick a category")
        it["category"] = cat
        if cat != "damage":
            it["charge"] = 0
        elif not it["charge"]:
            it["charge"] = it.get("estimate_low") or 0
    elif op == "add":
        x = body.get("item") or {}
        c = _num(x.get("charge"))
        if c is None or not (x.get("title") or "").strip():
            raise HTTPException(400, "Add a title and a price of $0 or more")
        new = validate_item({"category": "damage", "title": x["title"], "explanation": x.get("explanation") or "", "charge": c, "confidence": 1}, x.get("area_key") or "other",
                            None, x.get("photo_id"), source="landlord")
        if x.get("photo_id") and await db.files.find_one({"id": x["photo_id"], "owner_id": user["id"]}):
            await db.files.update_one({"id": x["photo_id"]}, {"$set": {"inspection_id": st["move_out_id"]}})
        items.append(new)
    else:
        raise HTTPException(400, "Unknown edit")
    recompute(st)  # totals always from the server, never from the app
    r = await db.deposit_statements.find_one_and_update(
        {"id": sid, "status": "draft", "version": st["version"]},
        {"$set": {"items": items, "total_deductions": st["total_deductions"], "refund": st["refund"], "over_deposit": st["over_deposit"]}, "$inc": {"version": 1}},
        projection=NF, return_document=True)
    if not r:
        raise HTTPException(409, "Updated elsewhere, pull to refresh")
    await db.approvals.update_one({"kind": "deposit_statement", "statement_id": sid, "status": "pending"},
                                  {"$set": {"amount": r["refund"], "reason": f"Refund {money(r['refund'])} of {money(r['deposit'])}. Due by {r['due_by']}."}})
    return await stmt_view(r)


def statement_pdf(v):
    rules = STATE_RULES.get(v["state"], {})
    lines = [f"Property: {v['property_name']} · {v['unit_label']}", f"Tenant: {v['tenant_name']}",
             f"Move-in: {v['move_in_date'] or 'no record'} · Move-out: {v['move_out_date']}", ""]
    charged = [i for i in v["items"] if i["category"] == "damage" and not i["removed"]]
    for i in charged:
        t = v["frame_times"].get(i.get("move_out_frame_id"))
        lines.append(f"{v['areas'].get(i['area_key'], i['area_key'])} — {i['title']}: {money(i['charge'])}. {i['explanation']}" + (f" (move-out video {t // 60}:{t % 60:02d})" if t is not None else ""))
    if not charged:
        lines.append("No charges.")
    lines += ["", f"Deposit: {money(v['deposit'])}", f"Deductions: {money(v['total_deductions'])}", f"Refund: {money(v['refund'])}",
              f"State: {rules.get('name', v['state'])} — deposit must be returned within {v.get('return_days')} days (by {v['due_by']}).",
              f"Date sent: {(v.get('sent_at') or iso())[:10]}"]
    return pdf_bytes("Itemized deposit statement", lines, "Prepared by Doorman. Normal wear and conditions present at move-in are never charged.")


@router.get("/statements/{sid}/pdf")
async def statement_pdf_ep(sid: str, user=Depends(get_media_user)):
    v = await stmt_view(await get_stmt(sid, user))
    return Response(await asyncio.to_thread(statement_pdf, v), media_type="application/pdf")


async def _refund(st, amount, note):
    pay = {"id": uid(), "unit_id": st["unit_id"], "tenant_id": st["tenant_id"], "landlord_id": st["landlord_id"], "period": iso()[:7], "kind": "deposit_refund",
           "amount": float(amount), "date": iso(), "source": "app_sim", "status": "recorded", "statement_id": st["id"], "note": note}
    await db.payments.insert_one(dict(pay))
    return pay


async def approve_statement(a):
    """Called from flows.apply_approval for kind=deposit_statement."""
    st = await db.deposit_statements.find_one_and_update({"id": a["statement_id"], "status": "draft"}, {"$set": {"status": "approved", "approved_at": iso()}},
                                                         projection=NF, return_document=True)
    if not st:
        raise HTTPException(409, "This statement was already approved")
    recompute(st)
    await _refund(st, st["refund"], "Deposit refund")
    sent = iso()
    await db.deposit_statements.update_one({"id": st["id"]}, {"$set": {"status": "sent", "sent_at": sent, "kept": st["total_deductions"],
                                                                     "refund": st["refund"], "total_deductions": st["total_deductions"]}})
    th = await tenant_thread(st["tenant_id"], st["landlord_id"])
    await post(th["id"], f"Your move-out statement is ready: {money(st['refund'])} refund.", cards=[{"type": "money", "ref_id": st["id"]}, {"type": "doc", "ref_id": st["id"]}])
    unit = await db.units.find_one({"id": st["unit_id"]}, NF)
    await activity(st["landlord_id"], f"Deposit statement sent for {unit['label']}: {money(st['total_deductions'])} kept, {money(st['refund'])} refunded.", None, "landlord")


async def drop_charge(a):
    """flows.apply_approval for kind=drop_charge: remove a disputed charge after sending and refund the difference."""
    st = await db.deposit_statements.find_one({"id": a["statement_id"], "status": "sent"}, NF)
    it = next((i for i in (st or {}).get("items", []) if i["id"] == a["item_id"] and not i["removed"] and i["category"] == "damage"), None)
    if not it:
        raise HTTPException(409, "This charge was already dropped")
    old = st["refund"]
    it["removed"], it["disputed"] = True, True
    recompute(st)
    r = await db.deposit_statements.find_one_and_update({"id": st["id"], "version": st["version"]},
                                                        {"$set": {"items": st["items"], "refund": st["refund"], "total_deductions": st["total_deductions"],
                                                                  "over_deposit": st["over_deposit"], "kept": st["total_deductions"]}, "$inc": {"version": 1}}, projection=NF)
    if not r:
        raise HTTPException(409, "Updated elsewhere, try again")
    diff = st["refund"] - old
    if diff > 0:
        await _refund(st, diff, f"Dropped charge: {it['title']}")
    th = await tenant_thread(st["tenant_id"], st["landlord_id"])
    await post(th["id"], f"Good news — the {it['title'].lower()} charge was dropped. {money(diff)} more is refunded (total refund {money(st['refund'])}). Here's the updated statement.",
               cards=[{"type": "money", "ref_id": st["id"]}, {"type": "doc", "ref_id": st["id"]}])
    await activity(st["landlord_id"], f"Dropped the {money(it['charge'])} {it['title'].lower()} charge — refunded {money(diff)}", None, "landlord")


async def statement_for_agent(tenant_id):
    st = await db.deposit_statements.find_one({"tenant_id": tenant_id, "status": "sent"}, NF, sort=[("created_at", -1)])
    if not st:
        return {"statement": "No move-out statement yet"}
    mi = await db.inspections.find_one({"id": st.get("move_in_id")}, NF) if st.get("move_in_id") else None
    return {"statement_id": st["id"], "deposit": st["deposit"], "refund": st["refund"],
            "charges": [{"item_id": i["id"], "area": i["area_key"], "title": i["title"], "charge": i["charge"], "explanation": i["explanation"]}
                        for i in st["items"] if i["category"] == "damage" and not i["removed"]],
            "move_in_record": [{"area": a["key"], "tenant_note": a.get("tenant_note"), "ai_note": a.get("ai_note")} for a in (mi or {}).get("areas", [])]}
