# Iteration 4: Ask Doorman triage (seat-aware, quick replies answered) + report insights (POST /reports/{pid}/check)
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for ln in open("/app/frontend/.env"):
        if ln.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = ln.split("=", 1)[1].strip().strip('"').rstrip("/")
API = f"{BASE_URL}/api"
REFUSAL = "I can only help with"


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def ask(tok, text, timeout=90):
    t = requests.get(f"{API}/threads/mine", headers=H(tok)).json()
    tid = t["id"]
    # wait until not busy
    for _ in range(60):
        if not requests.get(f"{API}/threads/{tid}", headers=H(tok)).json()["thread"].get("busy"):
            break
        time.sleep(2)
    before = requests.get(f"{API}/threads/{tid}", headers=H(tok)).json()["messages"]
    last_ts = before[-1]["created_at"] if before else None
    r = requests.post(f"{API}/threads/{tid}/messages", headers=H(tok), json={"text": text})
    assert r.status_code == 200, r.text
    start = time.time()
    while time.time() - start < timeout:
        time.sleep(3)
        d = requests.get(f"{API}/threads/{tid}", headers=H(tok)).json()
        if not d["thread"].get("busy"):
            new = [m for m in d["messages"] if (last_ts is None or m["created_at"] > last_ts) and m.get("role") != "user"]
            reply = "\n".join((m.get("text") or "") for m in new)
            print(f"\nQ: {text}\nA: {reply[:600]}\n  ({time.time()-start:.0f}s)")
            return reply, new
    pytest.fail(f"Timeout waiting for reply to {text!r}")


# Landlord quick replies must be answered (not refused)
class TestLandlordScope:
    def test_whos_late(self):
        reply, _ = ask("test-landlord-token", "Who's late?")
        assert REFUSAL not in reply
        assert "Tom" in reply or "Room A" in reply

    def test_repairs_spend(self):
        reply, _ = ask("test-landlord-token", "What did I spend on repairs?")
        assert REFUSAL not in reply
        assert "$" in reply

    def test_prefer_hank(self):
        reply, _ = ask("test-landlord-token", "Prefer Hank for plumbing")
        assert REFUSAL not in reply
        pol = requests.get(f"{API}/settings", headers=H("test-landlord-token")).json()["policies"]
        print("policies:", pol)
        assert any("hank" in str(p).lower() for p in pol)

    def test_offtopic_refused(self):
        reply, _ = ask("test-landlord-token", "What's a good pasta recipe?")
        assert REFUSAL in reply


# Tenant quick replies must be answered
class TestTenantScope:
    def test_rent_due(self):
        reply, _ = ask("test-tenant-token", "When is rent due?")
        assert REFUSAL not in reply and len(reply) > 10

    def test_my_rights(self):
        reply, _ = ask("test-tenant-token", "My rights")
        assert REFUSAL not in reply and len(reply) > 10


# Report insights endpoint
class TestReportCheck:
    @pytest.fixture(scope="class")
    def pid(self):
        props = requests.get(f"{API}/properties", headers=H("test-landlord-token")).json()
        props = props if isinstance(props, list) else props.get("properties", [])
        return props[0]["id"]

    def test_check_shape(self, pid):
        t = time.time()
        r = requests.post(f"{API}/reports/{pid}/check", headers=H("test-landlord-token"), timeout=90)
        print(f"check took {time.time()-t:.1f}s")
        assert r.status_code == 200, r.text
        d = r.json()
        print(d)
        assert d["headline"]
        assert isinstance(d["net"], (int, float))
        assert 1 <= len(d["insights"]) <= 4
        for i in d["insights"]:
            assert i["tone"] in ("risk", "opportunity", "good")
            assert i["title"] and i["detail"]
            assert "action_meta" in i

    def test_check_tenant_forbidden(self, pid):
        r = requests.post(f"{API}/reports/{pid}/check", headers=H("test-tenant-token"), timeout=60)
        assert r.status_code in (401, 403, 404)
