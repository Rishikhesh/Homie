# Auto-OK limit: handyman price <= landlord limit + tenant picks time => booked with no landlord tap. Payment still needs a tap.
import os, datetime as dt
from zoneinfo import ZoneInfo
import requests
from test_rentwise_api import B, get, post, upload, PNG
from test_single_slot_and_missed import _new_offer


def put(who, path, body):
    return requests.put(f"{B}{path}", json=body, headers={"Authorization": f"Bearer test-{who}-token"})


def _slot():
    day = (dt.datetime.now(ZoneInfo("America/Los_Angeles")) + dt.timedelta(days=2)).date()
    return f"{day.isoformat()}T10:00:00"


def _pending(tid):
    return [a for a in get("landlord", "/landlord/home").json()["approvals"] if a.get("ticket_id") == tid]


def test_settings_limit_roundtrip():
    assert get("landlord", "/settings").json()["auto_approve_limit"] == 200
    assert put("landlord", "/settings", {"auto_approve_limit": -5}).status_code == 400
    assert put("tenant", "/settings", {"auto_approve_limit": 500}).status_code == 403
    assert put("landlord", "/settings", {"auto_approve_limit": 300}).status_code == 200
    assert get("landlord", "/settings").json()["auto_approve_limit"] == 300
    assert put("landlord", "/settings", {"auto_approve_limit": 200}).status_code == 200
    assert get("tenant", "/settings").json()["auto_approve_limit"] is None


def test_under_limit_books_without_landlord():
    tid = _new_offer("The bathroom sink is dripping all the time, please send a plumber")
    assert post("handyman", f"/tickets/{tid}/accept", {"quote": 180, "slots": [_slot()]}).status_code == 200
    assert not _pending(tid), "no approval card for an under-limit price"
    t = get("tenant", f"/tickets/{tid}").json()
    card = get("tenant", f"/cards/choice_time/{tid}").json()
    assert card["auto"] is True and card["quote"] == 180
    r = post("tenant", f"/tickets/{tid}/pick-slot", {"slot": t["slots"][0]["iso"]})
    assert r.status_code == 200, r.text
    assert get("tenant", f"/tickets/{tid}").json()["status"] == "booked"
    # payment still needs the landlord's tap
    f = upload("handyman", "after.png", PNG + os.urandom(8))
    assert post("handyman", f"/tickets/{tid}/mark-fixed", {"final_amount": 180, "after_photo_id": f["id"]}).status_code == 200
    assert post("tenant", f"/tickets/{tid}/confirm", {"ok": True}).status_code == 200
    kinds = [a["kind"] for a in _pending(tid)]
    assert kinds == ["handyman_payment"], kinds


def test_over_limit_needs_landlord():
    tid = _new_offer("The kitchen drain is clogged and the water won't go down")
    assert post("handyman", f"/tickets/{tid}/accept", {"quote": 260, "slots": [_slot()]}).status_code == 200
    p = _pending(tid)
    assert p and p[0]["kind"] == "quote"
    t = get("tenant", f"/tickets/{tid}").json()
    post("tenant", f"/tickets/{tid}/pick-slot", {"slot": t["slots"][0]["iso"]})
    assert get("tenant", f"/tickets/{tid}").json()["status"] == "awaiting_tenant_time"
    post("tenant", f"/tickets/{tid}/cancel")


def test_limit_off_needs_landlord():
    assert put("landlord", "/settings", {"auto_approve_limit": 0}).status_code == 200
    try:
        tid = _new_offer("The toilet keeps running and won't stop")
        assert post("handyman", f"/tickets/{tid}/accept", {"quote": 90, "slots": [_slot()]}).status_code == 200
        assert _pending(tid), "limit off: every price needs a tap"
        post("tenant", f"/tickets/{tid}/cancel")
    finally:
        put("landlord", "/settings", {"auto_approve_limit": 200})


def test_limit_lowered_before_pick_falls_back_to_tap():
    tid = _new_offer("The shower head is leaking water everywhere")
    assert post("handyman", f"/tickets/{tid}/accept", {"quote": 150, "slots": [_slot()]}).status_code == 200
    assert put("landlord", "/settings", {"auto_approve_limit": 100}).status_code == 200
    try:
        t = get("tenant", f"/tickets/{tid}").json()
        post("tenant", f"/tickets/{tid}/pick-slot", {"slot": t["slots"][0]["iso"]})
        assert get("tenant", f"/tickets/{tid}").json()["status"] == "awaiting_tenant_time"
        assert [a["kind"] for a in _pending(tid)] == ["quote"]
        post("tenant", f"/tickets/{tid}/cancel")
    finally:
        put("landlord", "/settings", {"auto_approve_limit": 200})
