# Move-in / move-out inspections and deposit statements (plan section 10). Jev and Sonnet are faked with fixed answers.
import asyncio, io, os, subprocess, tempfile, time, uuid
from datetime import datetime, timedelta
import pytest, requests
import imageio_ffmpeg
from PIL import Image
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
import inspections as I  # noqa: E402

B = "http://localhost:8001/api"
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
NF = {"_id": 0}
H = lambda t: {"Authorization": f"Bearer test-{t}-token"}  # noqa: E731
S = {}


def ffmpeg_video(seconds, src="mandelbrot=size=640x480:rate=5"):
    d = tempfile.mkdtemp()
    out = os.path.join(d, "v.mp4")
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-loglevel", "error", "-f", "lavfi", "-i", src, "-t", str(seconds), "-pix_fmt", "yuv420p", out], check=True)
    return open(out, "rb").read()


def jpeg(w, h, color=(120, 120, 120)):
    b = io.BytesIO()
    Image.new("RGB", (w, h), color).save(b, "JPEG")
    return b.getvalue()


def upload(tok, data, name, ctype):
    r = requests.post(B + "/upload", headers=H(tok), files={"file": (name, io.BytesIO(data), ctype)}, timeout=120)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def landlord():
    return db.users.find_one({"email": "test.landlord@rentwise.test"}, NF)


def person(name):
    return db.users.find_one({"name": name, "is_sample": True, "sample_owner_id": landlord()["id"]}, NF)


# ---------- 1-3 capture and frames ----------
class TestFrames:
    def test_01_frames_rate_cap_dedupe(self):
        dur, frames = I.extract_frames(ffmpeg_video(40), "mp4")
        assert 1 < len(frames) <= I.MAX_FRAMES
        assert all(f["t_seconds"] % I.FRAME_EVERY_S == 0 for f in frames)
        assert all(max(f["size"]) <= I.FRAME_LONG_SIDE for f in frames)
        _, still = I.extract_frames(ffmpeg_video(10, "color=c=red:size=640x480:rate=5"), "mp4")
        assert len(still) == 1  # near-duplicates dropped

    def test_02_frame_size_gate_for_jev(self):
        called = []

        async def jev(*a):
            called.append(1)
            return {}

        async def son(*a):
            return {"category": "check"}, "x"

        small = {"id": "a", "jpeg": b"", "size": (200, 150)}
        ok = {"id": "b", "jpeg": b"", "size": (1024, 768)}
        stats = {k: 0 for k in ("pairs_screened", "sent_to_sonnet", "jev_calls", "sonnet_calls", "jev_tokens", "sonnet_tokens")}
        asyncio.run(I.screen_pairs([{"area_key": "k", "area": "Kitchen", "notes": "", "mi": ok, "mo": small}], jev, son, {}, stats))
        assert not called and stats["sonnet_calls"] == 1
        assert not I.jev_sized((1600, 900)) and I.jev_sized((1024, 768))

    def test_03_long_video_rejected(self):
        with pytest.raises(ValueError, match="under 45 seconds"):
            I.extract_frames(ffmpeg_video(50, "color=c=blue:size=320x240:rate=5"), "mp4")


# ---------- 5-8 routing ----------
STATS = lambda: {k: 0 for k in ("pairs_screened", "sent_to_sonnet", "jev_calls", "sonnet_calls", "jev_tokens", "sonnet_tokens")}  # noqa: E731
PAIR = {"area_key": "kitchen", "area": "Kitchen", "notes": "", "mi": {"id": "mi", "jpeg": b"", "size": (1024, 768)}, "mo": {"id": "mo", "jpeg": b"", "size": (1024, 768)}}


def run(jev_answer=None, jev_exc=None):
    calls = []

    async def jev(*a):
        if jev_exc:
            raise jev_exc
        return {"tokens": 10, "severity": 3, **jev_answer}

    async def son(*a):
        calls.append(1)
        return {"category": "damage", "title": "Burn mark", "explanation": "New burn on the counter.", "suggested_charge": 180.4, "estimate_low": 150,
                "estimate_high": 220, "confidence": 0.9, "severity": 3, "box": {"left": 0.6, "top": 0.6, "right": 0.8, "bottom": 0.8}}, "raw"

    st = STATS()
    items, _ = asyncio.run(I.screen_pairs([PAIR], jev, son, {}, st))
    return items, calls, st


class TestRouting:
    def test_05_confident_no_change_skips_sonnet(self):
        items, calls, st = run({"same_view": 0.9, "new_damage": 0.05, "kind": "none", "kind_confidence": 0.9})
        assert not items and not calls and st["pairs_screened"] == 1
        items, calls, _ = run({"same_view": 0.9, "new_damage": 0.1, "kind": "normal_wear", "kind_confidence": 0.8})
        assert not calls and items[0]["category"] == "normal_wear" and items[0]["charge"] == 0

    def test_06_flagged_pair_calls_sonnet(self):
        items, calls, _ = run({"same_view": 0.9, "new_damage": 0.7, "kind": "damage", "kind_confidence": 0.9})
        assert calls and items[0]["category"] == "damage" and items[0]["charge"] == 180 and items[0]["box"]

    def test_07_different_view_is_check(self):
        items, calls, _ = run({"same_view": 0.3, "new_damage": 0.9, "kind": "damage", "kind_confidence": 0.9})
        assert not calls and items[0]["category"] == "check" and items[0]["charge"] == 0

    def test_08_jev_error_falls_back_to_sonnet(self):
        items, calls, _ = run(jev_exc=RuntimeError("jev down"))
        assert calls and items[0]["category"] == "damage"

    def test_08b_big_visual_change_never_skips_sonnet(self):
        j = {"same_view": 0.9, "new_damage": 0.05, "kind": "none", "kind_confidence": 0.95, "severity": 1}
        assert I.route(j, 0)[0] == "none"
        assert I.route(j, I.PHASH_CHANGE)[0] == "sonnet"


# ---------- 9-11 validation ----------
class TestValidation:
    def test_09_unknown_category_and_non_damage_charge(self):
        assert I.validate_item({"category": "vandalism", "suggested_charge": 50}, "k")["category"] == "check"
        it = I.validate_item({"category": "normal_wear", "suggested_charge": 50}, "k")
        assert it["category"] == "normal_wear" and it["charge"] == 0

    def test_10_nan_negative_rejected(self):
        for bad in (float("nan"), -5, "abc"):
            it = I.validate_item({"category": "damage", "suggested_charge": bad, "confidence": 0.9}, "k")
            assert it["category"] == "check" and it["charge"] == 0

    def test_11_invalid_box_dropped(self):
        for b in ({"left": 0.5, "top": 0.1, "right": 0.4, "bottom": 0.3}, {"left": -0.1, "top": 0, "right": 0.5, "bottom": 0.5}, {"left": 0.1}):
            assert I.validate_item({"category": "damage", "suggested_charge": 10, "confidence": 0.9, "box": b}, "k")["box"] is None


# ---------- 12-13 maths ----------
class TestMaths:
    def test_12_13_cap_and_over_deposit(self):
        st = {"deposit": 1200, "items": [{"category": "damage", "charge": 900, "removed": False}, {"category": "damage", "charge": 500, "removed": False},
                                         {"category": "damage", "charge": 300, "removed": True}, {"category": "normal_wear", "charge": 0, "removed": False}]}
        I.recompute(st)
        assert st["total_deductions"] == 1200 and st["refund"] == 0 and st["over_deposit"] == 200
        assert st["refund"] + st["total_deductions"] == st["deposit"]


# ---------- HTTP: lock, statement edits, approval, money, deadline, privacy ----------
class TestFlowHTTP:
    def test_04_move_in_lock(self):
        tom = person("Tom Chen")
        db.inspections.delete_many({"tenant_id": tom["id"]})
        db.deposit_statements.delete_many({"tenant_id": tom["id"]})
        i = requests.post(B + "/inspections/move-in", headers=H("tenant"), timeout=30).json()
        S["mi"] = i["id"]
        vid = upload("tenant", ffmpeg_video(8), "kitchen.mp4", "video/mp4")
        r = requests.post(B + f"/inspections/{i['id']}/areas/kitchen/media", json={"file_id": vid}, headers=H("tenant"), timeout=120)
        assert r.status_code == 200, r.text
        S["frame"] = r.json()["frames"][0]["file_id"]
        requests.put(B + f"/inspections/{i['id']}/areas/kitchen/note", json={"note": "small chip on the counter"}, headers=H("tenant"), timeout=30)
        assert requests.post(B + f"/inspections/{i['id']}/submit", headers=H("tenant"), timeout=30).status_code == 200
        r = requests.post(B + f"/inspections/{i['id']}/confirm", headers=H("tenant"), timeout=30)
        assert r.status_code == 200 and r.json()["locked_at"]
        doc = db.inspections.find_one({"id": i["id"]}, NF)
        assert doc["report_hash"] == I.report_hash(doc)
        assert requests.put(B + f"/inspections/{i['id']}/areas/kitchen/note", json={"note": "edited"}, headers=H("tenant"), timeout=30).status_code == 409
        assert requests.post(B + f"/inspections/{i['id']}/areas/kitchen/media", json={"file_id": vid}, headers=H("tenant"), timeout=30).status_code == 409
        doc["areas"][0]["tenant_note"] = "tampered"
        assert I.report_hash(doc) != db.inspections.find_one({"id": i["id"]})["report_hash"]

    def test_22_due_by_uses_state_days(self):
        unit = db.units.find_one({"tenant_id": person("Tom Chen")["id"]}, NF)
        r = requests.post(B + f"/units/{unit['id']}/move-out", json={"move_out_date": "2026-11-01"}, headers=H("landlord"), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["due_by"] == "2026-11-22"  # CA: 21 days
        S["mo"] = r.json()["id"]

    def _seed_statement(self):
        tom = person("Tom Chen")
        unit = db.units.find_one({"tenant_id": tom["id"]}, NF)
        sid = uuid.uuid4().hex[:16]
        items = [I.validate_item({"category": "damage", "title": "Burn on counter", "suggested_charge": 180, "confidence": 0.9}, "kitchen", S["frame"], S["frame"]),
                 I.validate_item({"category": "normal_wear", "title": "Nail holes"}, "living_room")]
        st = {"id": sid, "unit_id": unit["id"], "tenant_id": tom["id"], "landlord_id": landlord()["id"], "property_id": unit["property_id"], "move_in_id": S["mi"],
              "move_out_id": S["mo"], "deposit": 1200.0, "items": items, "status": "draft", "due_by": "2026-11-22", "state": "CA", "version": 1,
              "created_at": datetime.utcnow().isoformat(), "raw_model_output": [], "stats": {}}
        I.recompute(st)
        db.deposit_statements.insert_one(dict(st))
        aid = uuid.uuid4().hex[:16]
        db.approvals.insert_one({"id": aid, "landlord_id": st["landlord_id"], "kind": "deposit_statement", "amount": st["refund"], "statement_id": sid, "status": "pending",
                                 "title": "Review", "reason": "", "recommendation": "", "urgent": False, "created_at": datetime.utcnow().isoformat(), "ticket_id": None, "tenant_id": tom["id"]})
        return sid, aid, items

    def patch(self, sid, body):
        v = db.deposit_statements.find_one({"id": sid})["version"]
        return requests.patch(B + f"/statements/{sid}", json={"version": v, **body}, headers=H("landlord"), timeout=30)

    def test_14_15_16_edits_recompute(self):
        sid, aid, items = self._seed_statement()
        S.update(sid=sid, aid=aid, burn=items[0]["id"], wear=items[1]["id"])
        r = self.patch(sid, {"op": "price", "item_id": items[0]["id"], "charge": 150, "refund": 1, "total_deductions": 9999})
        assert r.status_code == 200 and r.json()["refund"] == 1050 and r.json()["total_deductions"] == 150  # client totals ignored
        assert self.patch(sid, {"op": "remove", "item_id": items[0]["id"]}).json()["refund"] == 1200
        assert self.patch(sid, {"op": "undo", "item_id": items[0]["id"]}).json()["refund"] == 1050
        r = self.patch(sid, {"op": "category", "item_id": items[0]["id"], "category": "pre_existing"}).json()
        assert r["refund"] == 1200 and next(i for i in r["items"] if i["id"] == items[0]["id"])["charge"] == 0
        self.patch(sid, {"op": "category", "item_id": items[0]["id"], "category": "damage"})
        self.patch(sid, {"op": "price", "item_id": items[0]["id"], "charge": 180})
        r = self.patch(sid, {"op": "add", "item": {"area_key": "bathroom", "title": "Broken towel bar", "explanation": "Snapped off the wall.", "charge": 40}}).json()
        assert r["refund"] == 980 and r["total_deductions"] == 220
        stale = requests.patch(B + f"/statements/{sid}", json={"version": 1, "op": "remove", "item_id": items[0]["id"]}, headers=H("landlord"), timeout=30)
        assert stale.status_code == 409

    def test_23_privacy_before_and_after(self):
        assert requests.get(B + f"/statements/{S['sid']}", headers=H("tenant"), timeout=30).status_code == 404  # draft hidden from tenant
        assert requests.get(B + f"/inspections/{S['mi']}", headers=H("tenant2"), timeout=30).status_code == 404
        assert requests.get(B + f"/inspections/{S['mi']}", headers=H("handyman"), timeout=30).status_code == 403
        assert requests.get(B + f"/statements/{S['sid']}", headers=H("tenant2"), timeout=30).status_code == 404
        assert requests.get(B + f"/files/{S['frame']}", headers=H("tenant2"), timeout=30).status_code == 404
        assert requests.get(B + f"/files/{S['frame']}", headers=H("landlord"), timeout=30).status_code == 200

    def test_17_to_20_approve(self):
        r = requests.post(B + f"/approvals/{S['aid']}/decide", json={"action": "approve"}, headers=H("landlord"), timeout=60)
        assert r.status_code == 200, r.text
        assert requests.post(B + f"/approvals/{S['aid']}/decide", json={"action": "approve"}, headers=H("landlord"), timeout=60).status_code == 409
        st = db.deposit_statements.find_one({"id": S["sid"]}, NF)
        assert st["status"] == "sent" and st["kept"] == 220
        assert self.patch(S["sid"], {"op": "remove", "item_id": S["burn"]}).status_code == 409  # editing after approval
        tom = person("Tom Chen")
        th = db.threads.find_one({"kind": "tenant", "tenant_id": tom["id"]})
        assert db.messages.find_one({"thread_id": th["id"], "cards.statement_id": S["sid"]})
        pdf = requests.get(B + f"/statements/{S['sid']}/pdf", headers=H("tenant"), timeout=30)
        assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
        pays = list(db.payments.find({"statement_id": S["sid"], "kind": "deposit_refund"}, NF))
        assert len(pays) == 1 and pays[0]["amount"] == 980
        assert requests.get(B + f"/statements/{S['sid']}", headers=H("tenant"), timeout=30).status_code == 200
        rep = requests.get(B + f"/reports/{st['property_id']}", headers=H("landlord"), timeout=30).json()
        assert rep["deposit_kept"] >= 220
        assert rep["rents_received"] >= rep["deposit_kept"]

    def test_21_drop_charge_refunds_difference(self):
        aid = uuid.uuid4().hex[:16]
        db.approvals.insert_one({"id": aid, "landlord_id": landlord()["id"], "kind": "drop_charge", "amount": 180, "statement_id": S["sid"], "item_id": S["burn"],
                                 "status": "pending", "title": "Drop", "reason": "", "recommendation": "", "urgent": False, "created_at": datetime.utcnow().isoformat(), "ticket_id": None, "tenant_id": None})
        assert requests.post(B + f"/approvals/{aid}/decide", json={"action": "approve"}, headers=H("landlord"), timeout=60).status_code == 200
        st = db.deposit_statements.find_one({"id": S["sid"]}, NF)
        assert st["refund"] == 1160 and st["kept"] == 40
        extra = [p for p in db.payments.find({"statement_id": S["sid"], "kind": "deposit_refund"}, NF)]
        assert sorted(p["amount"] for p in extra) == [180, 980]
        item = next(i for i in st["items"] if i["id"] == S["burn"])
        assert item["removed"] and item["disputed"]
