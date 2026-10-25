# Iteration 15: LIVE handyman calls over the public URL (real LLM + Emergent voice): settings, prefs, ring→decline/miss fallback, answer→accept, calls-off regression
import re, time
import pytest, requests
from test_rentwise_api import B, get, post, wait_idle, tenant_tickets
from test_single_slot_and_missed import _new_offer

S = {}
HANK = "4153c8fd2e9d439f"


def put(tok, path, js): return requests.put(B + path, json=js, headers={"Authorization": f"Bearer test-{tok}-token"}, timeout=30)
def patch(tok, path, js): return requests.patch(B + path, json=js, headers={"Authorization": f"Bearer test-{tok}-token"}, timeout=30)


def msgs(tok, thread_id):
    return get(tok, f"/threads/{thread_id}").json()["messages"]


def tenant_thread():
    return get("tenant", "/threads/mine").json()["id"]


def ringing_for(tid, limit=20):
    t0 = time.time()
    while time.time() - t0 < limit:
        c = get("handyman", "/calls/incoming").json()["call"]
        if c:
            full = get("handyman", f"/calls/{c['id']}").json()
            if full["ticket_id"] == tid:
                return full
        time.sleep(1)
    return None


@pytest.fixture(scope="module", autouse=True)
def calls_on():
    assert put("landlord", "/settings", {"handyman_calls": True}).status_code == 200
    assert patch("handyman", "/handyman/profile", {"contact_pref": "call"}).status_code == 200
    yield
    put("landlord", "/settings", {"handyman_calls": False})
    patch("handyman", "/handyman/profile", {"contact_pref": "message"})
    for t in tenant_tickets():
        if t["status"] not in ("closed", "cancelled"):
            post("tenant", f"/tickets/{t['id']}/cancel")


# ---- settings / preferences
class TestPrefs:
    def test_settings_persist(self):
        assert get("landlord", "/settings").json()["handyman_calls"] is True

    def test_profile_pref_and_landlord_list(self):
        assert get("handyman", "/handyman/profile").json()["contact_pref"] == "call"
        r = get("landlord", "/handymen/mine").json()
        lst = r if isinstance(r, list) else r.get("handymen", r.get("mine", []))
        hank = [x for x in lst if x.get("user_id") == HANK]
        assert hank and hank[0].get("contact_pref") == "call", hank

    def test_validation(self):
        assert patch("handyman", "/handyman/profile", {"contact_pref": "sms"}).status_code == 422
        assert patch("tenant", "/handyman/profile", {"contact_pref": "call"}).status_code == 403
        assert put("tenant", "/settings", {"handyman_calls": True}).status_code == 403


# ---- ring → decline on ring screen → text offer fallback
class TestDecline:
    def test_01_ring(self):
        tid = _new_offer("My kitchen sink is clogged and the water won't drain")
        S["d_tid"] = tid
        c = ringing_for(tid)
        assert c and c["status"] == "ringing", "no ringing call"
        S["d_call"] = c
        tm = [m["text"] for m in msgs("tenant", tenant_thread())[-6:]]
        assert any("calling Hank" in x for x in tm), tm
        jt = get("landlord", f"/tickets/{tid}").json()["job_thread_id"]
        S["d_jt"] = jt
        assert not any(cd.get("type") == "offer" for m in msgs("handyman", jt) for cd in (m.get("cards") or [])), "text offer posted before call ended"

    def test_02_security(self):
        cid = S["d_call"]["id"]
        assert post("landlord", f"/calls/{cid}/answer").status_code == 403
        assert post("tenant", f"/calls/{cid}/decline").status_code == 403
        assert get("tenant", f"/calls/{cid}").status_code == 404
        assert get("landlord", f"/calls/{cid}").status_code == 200

    def test_03_decline_fallback(self):
        cid = S["d_call"]["id"]
        r = post("handyman", f"/calls/{cid}/decline")
        assert r.status_code == 200 and r.json()["status"] == "declined"
        assert get("handyman", f"/calls/{cid}").json()["status"] == "declined"
        jm = msgs("handyman", S["d_jt"])
        offers = [m for m in jm if any(cd.get("type") == "offer" for cd in (m.get("cards") or []))]
        assert offers and offers[-1]["text"].startswith("Tried calling you"), [m["text"][:60] for m in jm]
        tm = [m["text"] for m in msgs("tenant", tenant_thread())[-6:]]
        assert any("didn't pick up, so I've messaged him too" in x for x in tm), tm
        t = get("handyman", f"/tickets/{S['d_tid']}").json()
        assert t["status"] == "offered"
        assert post("handyman", f"/calls/{cid}/answer").status_code == 409


# ---- ring → answer → typed price+time → accepted (no money approved)
class TestAnswerAccept:
    def test_01_answer(self):
        tid = _new_offer("The bathroom sink is clogged, water won't go down")
        S["a_tid"] = tid
        c = ringing_for(tid)
        assert c, "no ringing call"
        S["a_call"] = c["id"]
        r = post("handyman", f"/calls/{c['id']}/answer")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "active" and d["text"].startswith("Hi Hank"), d
        S["audio"] = d.get("audio_url")
        assert post("landlord", f"/calls/{c['id']}/say", {"text": "hi"}).status_code == 403

    def test_02_opening_audio(self):
        if not S.get("audio"):
            pytest.fail("no TTS audio for opening line")
        r = requests.get(B + S["audio"], headers={"Authorization": "Bearer test-handyman-token"}, timeout=30)
        assert r.status_code == 200 and r.headers["content-type"].startswith("audio") and len(r.content) > 1000

    def test_03_say_accept(self):
        cid = S["a_call"]
        r = requests.post(B + f"/calls/{cid}/say", json={"text": "Thursday at 3 pm, $140, confirmed"}, headers={"Authorization": "Bearer test-handyman-token"}, timeout=120)
        assert r.status_code == 200, r.text
        d = r.json()
        S["reply"] = d
        print("REPLY:", d)
        n = len([x for x in re.split(r"(?<=[.!?])\s+", d["text"].strip()) if x])
        assert n <= 2, d["text"]
        if not d["ended"]:  # agent may repeat back and ask to confirm
            r = requests.post(B + f"/calls/{cid}/say", json={"text": "Yes, confirmed"}, headers={"Authorization": "Bearer test-handyman-token"}, timeout=120)
            d = r.json(); S["reply2"] = d; print("REPLY2:", d)
        assert d["ended"] and d["outcome"] == "accepted", d

    def test_04_ticket_and_approval(self):
        t = get("landlord", f"/tickets/{S['a_tid']}").json()
        assert t["status"] == "awaiting_tenant_time", t["status"]
        ap = t.get("pending_approval")
        assert ap and ap["status"] == "pending", ap
        c = get("landlord", f"/calls/{S['a_call']}").json()
        assert c["status"] == "ended" and c["outcome"] == "accepted" and c["summary"]
        assert any(x.get("call_id") == S["a_call"] for x in t.get("timeline", [])), "no timeline call row"
        jm = msgs("landlord", t["job_thread_id"])
        assert any(cd.get("type") == "call" and cd.get("call_id") == S["a_call"] for m in jm for cd in (m.get("cards") or []))
        assert post("handyman", f"/calls/{S['a_call']}/hangup").status_code == 409


# ---- ring out (20 s demo) → missed → text offer
class TestMissed:
    def test_missed(self):
        tid = _new_offer("My kitchen sink is clogged and the water won't drain at all, please send a plumber")
        c = ringing_for(tid)
        assert c, "no ringing call"
        t0 = time.time()
        while time.time() - t0 < 75:
            st = get("handyman", f"/calls/{c['id']}").json()["status"]
            if st != "ringing":
                break
            time.sleep(3)
        print("missed after", int(time.time() - t0), "s")
        assert st == "missed", st
        jt = get("landlord", f"/tickets/{tid}").json()["job_thread_id"]
        assert any(m["text"].startswith("Tried calling you") for m in msgs("handyman", jt))


# ---- calls off → normal text offer (regression)
class TestCallsOff:
    def test_text_offer_when_off(self):
        assert put("landlord", "/settings", {"handyman_calls": False}).status_code == 200
        tid = _new_offer("The bathroom sink is clogged, water won't go down, please send a plumber")
        assert get("handyman", "/calls/incoming").json()["call"] is None
        jt = get("landlord", f"/tickets/{tid}").json()["job_thread_id"]
        assert any(cd.get("type") == "offer" for m in msgs("handyman", jt) for cd in (m.get("cards") or []))
