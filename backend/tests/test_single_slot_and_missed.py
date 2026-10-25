# Iteration 5: single-slot handyman accept, missed jobs list, Plaid sandbox deposit validation
import datetime as dt
from zoneinfo import ZoneInfo
import pytest, requests
from test_rentwise_api import B, get, post, wait_idle, tenant_tickets

S = {}


def _new_offer(text):
    th = get("tenant", "/threads/mine").json()["id"]
    for t in tenant_tickets():  # agent de-dups open issues
        if t["status"] not in ("closed", "cancelled"):
            post("tenant", f"/tickets/{t['id']}/cancel")
    before = {t["id"] for t in tenant_tickets()}
    r = post("tenant", f"/threads/{th}/messages", {"text": text})
    assert r.status_code == 200, r.text
    wait_idle("tenant", th)
    new = [t for t in tenant_tickets() if t["id"] not in before]
    assert new, "no ticket created"
    tid = new[0]["id"]
    offers = [o["id"] for o in get("handyman", "/handyman/jobs").json()["offers"]]
    assert tid in offers, f"not offered to Hank: {offers}"
    return tid


# ---- single wall-clock slot accept
class TestSingleSlotAccept:
    def test_01_create_offer(self):
        S["tid"] = _new_offer("The kitchen faucet is dripping constantly, please send a plumber")

    def test_02_validation(self):
        tid = S["tid"]
        assert post("handyman", f"/tickets/{tid}/accept", {"quote": 150, "slots": []}).status_code == 400
        assert post("handyman", f"/tickets/{tid}/accept", {"quote": 0, "slots": ["2030-01-01T10:00:00"]}).status_code == 400
        assert get("handyman", f"/tickets/{tid}").json()["status"] == "offered"

    def test_03_accept_one_wallclock_slot(self):
        tid = S["tid"]
        day = (dt.datetime.now(ZoneInfo("America/Los_Angeles")) + dt.timedelta(days=1)).date()
        wall = f"{day.isoformat()}T10:00:00"
        r = post("handyman", f"/tickets/{tid}/accept", {"quote": 250, "slots": [wall]})
        assert r.status_code == 200, r.text
        t = get("handyman", f"/tickets/{tid}").json()
        assert t["status"] == "awaiting_tenant_time"
        assert len(t["slots"]) == 1
        got = dt.datetime.fromisoformat(t["slots"][0]["iso"]).astimezone(ZoneInfo("America/Los_Angeles"))
        assert (got.date(), got.hour, got.minute) == (day, 10, 0), got
        assert t["slots"][0]["label"] == f"{got.strftime('%a')} 10 am", t["slots"][0]["label"]
        S["slot"] = t["slots"][0]

    def test_04_landlord_quote_approval(self):
        t = get("landlord", f"/tickets/{S['tid']}").json()
        pa = t["pending_approval"]
        assert pa and pa["kind" if "kind" in pa else "type"] == "quote" and float(pa["amount"]) == 250, pa

    def test_05_tenant_sees_one_slot_and_picks(self):
        t = get("tenant", f"/tickets/{S['tid']}").json()
        assert len(t["slots"]) == 1
        r = post("tenant", f"/tickets/{S['tid']}/pick-slot", {"slot": S["slot"]["iso"]})
        assert r.status_code == 200, r.text

    def test_06_cleanup(self):
        post("tenant", f"/tickets/{S['tid']}/cancel")


# ---- missed jobs
class TestMissedJobs:
    def test_01_decline_shows_in_missed(self):
        tid = _new_offer("Bathroom sink drain is clogged and water won't go down")
        r = post("handyman", f"/tickets/{tid}/decline")
        assert r.status_code == 200, r.text
        d = get("handyman", "/handyman/jobs").json()
        assert tid not in [o["id"] for o in d["offers"]]
        m = [x for x in d["missed"] if x["id"] == tid]
        assert m, d["missed"]
        assert m[0]["reason"] == "declined" and m[0]["title"] and m[0]["city"] and m[0]["trade"] and m[0]["at"]
        S["missed_tid"] = tid

    def test_02_decline_again_rejected(self):  # handyman loses access after declining -> 404
        assert post("handyman", f"/tickets/{S['missed_tid']}/decline").status_code in (403, 404, 409)

    def test_03_missed_requires_handyman(self):
        assert get("tenant", "/handyman/jobs").status_code == 403

    def test_04_cleanup(self):
        post("tenant", f"/tickets/{S['missed_tid']}/cancel")


# ---- plaid sandbox deposit validation
class TestPlaidDepositValidation:
    @pytest.mark.parametrize("body", [{}, {"amount": "abc"}, {"amount": -5}, {"amount": 0}, {"amount": None}])
    def test_bad_amount_422(self, body):
        st = get("landlord", "/plaid/status").json()
        r = post("landlord", "/plaid/sandbox/deposit", body)
        if r.status_code == 400 and "Link a bank" in r.text:
            pytest.skip(f"Plaid not linked: {st}")
        assert r.status_code == 422, (r.status_code, r.text)


# ---- non rent-like Plaid deposit stays out of Needs review (real Plaid Sandbox, async processing)
class TestPlaidNonRentDeposit:
    def test_odd_deposit_goes_to_history(self):
        import time, random
        amt = round(random.uniform(11, 49), 2)
        r = post("landlord", "/plaid/sandbox/deposit", {"amount": amt, "sender_name": "TEST Coffee refund"})
        if r.status_code == 400 and "Link a bank" in r.text:
            pytest.skip("Plaid not linked")
        assert r.status_code == 200, r.text
        found = None
        for _ in range(12):
            time.sleep(5)
            post("landlord", "/plaid/sync")
            b = get("landlord", "/money/bank").json()
            found = next((t for t in b["review"] + b["feed"] if abs(t["amount"] - amt) < 0.01 and t.get("source") == "plaid"), None)
            if found:
                break
        assert found, f"deposit {amt} not imported after 60s"
        assert found["status"] == "history", found
