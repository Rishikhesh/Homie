"""Handyman calls (mocked STT, TTS, storage and LLM). Uses the seeded demo: Tom (tenant), Hank / Rosa / Sam (handymen)."""
import asyncio, os, sys
from pathlib import Path
import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv  # noqa: E402
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
API = os.environ.get("EVAL_BASE_URL", "http://localhost:8001").rstrip("/") + "/api"
LOOP = asyncio.new_event_loop()
run = LOOP.run_until_complete

import calls, flows, agent, voice  # noqa: E402
from core import db, NF, uid, iso, now  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from datetime import timedelta  # noqa: E402


class TC:
    def __init__(self, name, args):
        self.id, self.name, self.arguments = uid(), name, args


class Resp:
    def __init__(self, content="", tool_calls=None):
        self.content, self.tool_calls = content, tool_calls or []


class FakeChat:
    def __init__(self, plan):
        self.plan, self.i = plan, 0

    def with_tools(self, _):
        return self

    def add_tool_result(self, *_):
        pass

    async def send_message_with_tools(self, *_a, **_k):
        self.i += 1
        return self.plan[self.i - 1] if self.i <= len(self.plan) else Resp("Thanks, talk soon.")


@pytest.fixture(autouse=True)
def mocks(monkeypatch):
    async def speak(text):
        return b"ID3fake", "audio/mpeg", "emergent"

    async def stt(data, mime=None):
        return "Thursday at three, about one forty", "emergent"

    async def summ(*_a, **_k):
        return "Agreed Thu 3 pm for $140"
    monkeypatch.setattr(voice, "speak_text", speak)
    monkeypatch.setattr(voice, "transcribe_bytes", stt)
    monkeypatch.setattr(calls, "put_object", lambda path, data, ct: {"path": path})
    monkeypatch.setattr(agent, "quick", summ)
    yield


async def _setup(pref_by_name, urgency="normal"):
    tom = await db.users.find_one({"name": "Tom Chen"}, NF)
    unit = await db.units.find_one({"tenant_id": tom["id"]}, NF)
    hs = {}
    for name, pref in pref_by_name.items():
        h = await db.handymen.find_one({"name": {"$regex": f"^{name}"}}, NF)
        await db.handymen.update_one({"user_id": h["user_id"]}, {"$set": {"contact_pref": pref}})
        hs[name] = {**h, "contact_pref": pref}
    t = {"id": uid(), "tenant_id": tom["id"], "landlord_id": unit["landlord_id"], "unit_id": unit["id"], "property_id": unit["property_id"], "title": "Dryer not heating",
         "description": "Runs but no heat", "trade": "appliance", "urgency": urgency, "status": "finding_handyman", "photos": [], "timeline": [], "declined_by": [],
         "created_at": iso(), "status_at": iso()}
    await db.tickets.insert_one(dict(t))
    return t, hs, unit


async def _cleanup(t, unit):
    await db.tickets.delete_one({"id": t["id"]})
    await db.calls.delete_many({"ticket_id": t["id"]})
    await db.approvals.delete_many({"ticket_id": t["id"]})
    await db.handymen.update_many({}, {"$set": {"contact_pref": "message"}})


async def _offers(t, hid):
    th = await db.threads.find_one({"kind": "job", "ticket_id": t["id"], "handyman_id": hid}, NF)
    if not th:
        return []
    return [m async for m in db.messages.find({"thread_id": th["id"], "cards.type": "offer"}, NF)]


def test_1_calls_off_everyone_gets_text():
    async def go():
        t, hs, unit = await _setup({"Hank": "message"})
        try:
            await flows.offer_job(t, hs["Hank"])
            assert await db.calls.count_documents({"ticket_id": t["id"]}) == 0
            assert len(await _offers(t, hs["Hank"]["user_id"])) == 1
        finally:
            await _cleanup(t, unit)
    run(go())


def test_2_message_pref_text_offer_no_call():
    async def go():
        t, hs, unit = await _setup({"Rosa": "message"})
        try:
            await flows.offer_job(t, hs["Rosa"])
            assert await db.calls.count_documents({"ticket_id": t["id"]}) == 0
            assert len(await _offers(t, hs["Rosa"]["user_id"])) == 1
        finally:
            await _cleanup(t, unit)
    run(go())


def test_3_and_4_call_pref_rings_then_falls_back_on_timeout():
    async def go():
        t, hs, unit = await _setup({"Hank": "call"})
        try:
            await flows.offer_job(t, hs["Hank"])
            c = await db.calls.find_one({"ticket_id": t["id"]}, NF)
            assert c["status"] == "ringing" and not await _offers(t, hs["Hank"]["user_id"])
            tt = await db.threads.find_one({"kind": "tenant", "tenant_id": t["tenant_id"]}, NF)
            last = await db.messages.find_one({"thread_id": tt["id"]}, NF, sort=[("created_at", -1)])
            assert "calling" in last["text"].lower()
            await db.calls.update_one({"id": c["id"]}, {"$set": {"ring_started_at": iso(now() - timedelta(seconds=calls.RING_S + 5))}})
            await calls.tick_calls()
            c = await db.calls.find_one({"id": c["id"]}, NF)
            assert c["status"] == "missed"
            offers = await _offers(t, hs["Hank"]["user_id"])
            assert len(offers) == 1 and offers[0]["text"].startswith("Tried calling you")
            tk = await db.tickets.find_one({"id": t["id"]}, NF)
            assert any("no answer" in x["text"] for x in tk["timeline"])
        finally:
            await _cleanup(t, unit)
    run(go())


def test_4b_decline_on_ring_screen_falls_back():
    async def go():
        t, hs, unit = await _setup({"Hank": "call"})
        try:
            await flows.offer_job(t, hs["Hank"])
            c = await db.calls.find_one({"ticket_id": t["id"]}, NF)
            await calls.fall_back(c, "declined")
            assert (await db.calls.find_one({"id": c["id"]}, NF))["status"] == "declined"
            assert len(await _offers(t, hs["Hank"]["user_id"])) == 1
            with pytest.raises(HTTPException) as e:  # atomic: second move → 409
                await calls.fall_back(c, "missed")
            assert e.value.status_code == 409
        finally:
            await _cleanup(t, unit)
    run(go())


def test_5_and_6_escalation_chain_then_self_fix():
    async def go():
        t, hs, unit = await _setup({"Hank": "call", "Rosa": "message", "Sam": "call"})
        try:
            await flows.start_matching(t)
            seen = []
            for _ in range(6):
                tk = await db.tickets.find_one({"id": t["id"]}, NF)
                if tk["status"] != "offered":
                    break
                seen.append(tk["handyman_id"])
                await flows.handyman_decline(tk, tk["handyman_id"], "expired")
            names = {h["user_id"]: n for n, h in hs.items()}
            assert [names.get(x) for x in seen][:1] == ["Hank"]
            assert set(names.get(x) for x in seen) >= {"Hank", "Rosa"}
            tk = await db.tickets.find_one({"id": t["id"]}, NF)
            assert tk["status"] != "offered"  # nobody left → self-fix / landlord flow took over
        finally:
            await _cleanup(t, unit)
    run(go())


async def _answered(plan, said="Thursday at three, about one forty"):
    t, hs, unit = await _setup({"Hank": "call"})
    await flows.offer_job(t, hs["Hank"])
    c = await db.calls.find_one({"ticket_id": t["id"]}, NF)
    c = await calls.move(c["id"], "ringing", "active", {"answered_at": iso()})
    user = await db.users.find_one({"id": hs["Hank"]["user_id"]}, NF)
    agent_llm = agent.llm
    agent.llm = lambda *a, **k: FakeChat(plan)
    try:
        reply, outcome = await calls.agent_turn(c, said, user)
    finally:
        agent.llm = agent_llm
    return t, hs, unit, c, outcome, reply


def test_7_accept_by_voice_creates_quote_approval_not_money():
    async def go():
        slot = (now() + timedelta(days=3)).strftime("%Y-%m-%dT15:00")
        t, hs, unit, c, outcome, _ = await _answered([Resp(tool_calls=[TC("accept_job", {"quote": 340, "slots": [slot]})]), Resp("Great, sent to the owner.")])
        try:
            assert outcome == "accepted"
            tk = await db.tickets.find_one({"id": t["id"]}, NF)
            assert tk["status"] == "awaiting_tenant_time" and tk["quote"] == 340 and tk["slots"]
            a = await db.approvals.find_one({"ticket_id": t["id"]}, NF)
            assert a and a["status"] == "pending"  # money waits for the landlord's tap
            assert not tk.get("approved_amount")
        finally:
            await _cleanup(t, unit)
    run(go())


def test_8_decline_by_voice_moves_on():
    async def go():
        t, hs, unit, c, outcome, _ = await _answered([Resp(tool_calls=[TC("decline_job", {"reason": "busy"})]), Resp("No problem, thanks.")], "Can't do it this week")
        try:
            assert outcome == "declined"
            tk = await db.tickets.find_one({"id": t["id"]}, NF)
            assert hs["Hank"]["user_id"] in tk["declined_by"] and tk.get("handyman_id") != hs["Hank"]["user_id"]
        finally:
            await _cleanup(t, unit)
    run(go())


def test_9_undecided_posts_text_offer_and_window_runs():
    async def go():
        t, hs, unit, c, outcome, _ = await _answered([Resp(tool_calls=[TC("end_call", {})]), Resp("Okay, tap Accept when ready.")], "Let me check and get back to you")
        try:
            assert outcome == "undecided"
            c = await db.calls.find_one({"id": c["id"]}, NF)
            await calls.end_call(c, "undecided")
            offers = await _offers(t, hs["Hank"]["user_id"])
            assert any(m["text"].startswith("Thanks for the chat") for m in offers)
            tk = await db.tickets.find_one({"id": t["id"]}, NF)
            assert tk["status"] == "offered" and tk["offered_at"]
        finally:
            await _cleanup(t, unit)
    run(go())


def test_10_only_called_handyman_and_one_live_call():
    async def go():
        t, hs, unit = await _setup({"Hank": "call"})
        try:
            await flows.offer_job(t, hs["Hank"])
            c = await db.calls.find_one({"ticket_id": t["id"]}, NF)
            rosa = await db.handymen.find_one({"name": {"$regex": "^Rosa"}}, NF)
            ru = await db.users.find_one({"id": rosa["user_id"]}, NF)
            with pytest.raises(HTTPException) as e:
                await calls._mine(c["id"], ru)
            assert e.value.status_code == 403
            jt = await db.threads.find_one({"id": c["thread_id"]}, NF)
            assert await calls.start_call(t, hs["Hank"], jt) is None  # second live call refused
        finally:
            await _cleanup(t, unit)
    run(go())


def test_10b_http_403_and_404():
    assert requests.post(f"{API}/calls/nope/answer", headers={"Authorization": "Bearer test-handyman-token"}, timeout=10).status_code == 404
    assert requests.post(f"{API}/calls/nope/answer", headers={"Authorization": "Bearer test-tenant-token"}, timeout=10).status_code == 403


def test_11_contacts_stripped():
    async def go():
        t, hs, unit = await _setup({"Hank": "call"})
        try:
            await flows.offer_job(t, hs["Hank"])
            c = await db.calls.find_one({"ticket_id": t["id"]}, NF)
            out = await calls._say(c, "Call me at 408-555-1234 or hank@x.com")
            assert "555" not in out["text"] and "@" not in out["text"]
        finally:
            await _cleanup(t, unit)
    run(go())


def test_12_elevenlabs_error_falls_back(monkeypatch):
    import importlib
    v = importlib.reload(voice)
    monkeypatch.setattr(v, "VOICE_PROVIDER", "elevenlabs")

    async def em(text):
        return b"ok", "audio/mpeg"
    monkeypatch.setattr(v, "_emergent_speak", em)
    _, _, prov = run(v.speak_text("hello"))
    assert prov == "emergent"


def test_13_five_minute_cap_ends_and_leaves_offer_open():
    async def go():
        t, hs, unit = await _setup({"Hank": "call"})
        try:
            await flows.offer_job(t, hs["Hank"])
            c = await db.calls.find_one({"ticket_id": t["id"]}, NF)
            await calls.move(c["id"], "ringing", "active", {"answered_at": iso(now() - timedelta(seconds=calls.MAX_CALL_S + 5))})
            await calls.tick_calls()
            c = await db.calls.find_one({"id": c["id"]}, NF)
            assert c["status"] == "ended" and c["outcome"] == "undecided"
            assert await _offers(t, hs["Hank"]["user_id"])
        finally:
            await _cleanup(t, unit)
    run(go())


def test_14_emergency_uses_short_window():
    src = (Path(__file__).resolve().parents[1] / "flows.py").read_text()
    assert '"urgency": "emergency", "offered_at": {"$lt": cut(900)}' in src


def test_15_contact_pref_validation():
    H = {"Authorization": "Bearer test-handyman-token"}
    assert requests.patch(f"{API}/handyman/profile", json={"contact_pref": "sms"}, headers=H, timeout=10).status_code == 422
    assert requests.patch(f"{API}/handyman/profile", json={"contact_pref": "call"}, headers={"Authorization": "Bearer test-landlord-token"}, timeout=10).status_code == 403
    r = requests.patch(f"{API}/handyman/profile", json={"contact_pref": "call"}, headers=H, timeout=10)
    assert r.status_code == 200
    assert requests.get(f"{API}/handyman/profile", headers=H, timeout=10).json()["contact_pref"] == "call"
    requests.patch(f"{API}/handyman/profile", json={"contact_pref": "message"}, headers=H, timeout=10)
