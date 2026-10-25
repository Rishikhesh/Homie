# Iteration 5: Plaid Sandbox bank feed (status, hosted link start, link status, sandbox deposit -> sync -> bank feed, idempotency, role guard)
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
L = {"Authorization": "Bearer test-landlord-token", "Content-Type": "application/json"}
T = {"Authorization": "Bearer test-tenant-token", "Content-Type": "application/json"}


def bank_rows():
    d = requests.get(f"{API}/money/bank", headers=L, timeout=30).json()
    seen, rows = set(), []
    for x in (d.get("review") or []) + (d.get("feed") or []):
        if x["id"] not in seen:
            seen.add(x["id"])
            rows.append(x)
    return d, rows


# Status
class TestPlaidStatus:
    def test_status_configured_and_linked(self):
        r = requests.get(f"{API}/plaid/status", headers=L, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        print(d)
        assert d["configured"] is True
        assert d["env"] == "sandbox"
        assert any("First Platypus" in (i.get("institution") or "") for i in d["items"])

    def test_status_tenant_forbidden(self):
        r = requests.get(f"{API}/plaid/status", headers=T, timeout=30)
        assert r.status_code == 403, r.text

    def test_sync_tenant_forbidden(self):
        assert requests.post(f"{API}/plaid/sync", headers=T, timeout=30).status_code == 403

    def test_deposit_tenant_forbidden(self):
        r = requests.post(f"{API}/plaid/sandbox/deposit", headers=T, json={"sender_name": "x", "amount": 1}, timeout=30)
        assert r.status_code == 403


# Hosted Link start + link status
class TestPlaidLink:
    def test_link_start_and_status(self):
        r = requests.post(f"{API}/plaid/link/start", headers=L, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["link_token"].startswith("link-sandbox-")
        assert d["hosted_link_url"].startswith("https://")
        s = requests.get(f"{API}/plaid/link/status/{d['link_token']}", headers=L, timeout=30)
        assert s.status_code == 200, s.text
        assert s.json()["status"] == "created"

    def test_link_status_unknown_404(self):
        r = requests.get(f"{API}/plaid/link/status/link-sandbox-doesnotexist", headers=L, timeout=30)
        assert r.status_code == 404

    def test_complete_page(self):
        r = requests.get(f"{API}/plaid/complete", timeout=30)
        assert r.status_code == 200 and "Bank linked" in r.text


# Sandbox deposit -> sync -> appears in feed; idempotent re-sync
class TestPlaidDepositSync:
    def test_deposit_sync_feed_idempotent(self):
        _, before = bank_rows()
        before_ids = {x["id"] for x in before}
        amt = 100 + (int(time.time()) % 50)  # unique-ish amount
        r = requests.post(f"{API}/plaid/sandbox/deposit", headers=L, json={"sender_name": "Maria Lopez rent", "amount": amt}, timeout=60)
        assert r.status_code == 200, r.text
        imported = 0
        for _ in range(8):
            time.sleep(8)
            s = requests.post(f"{API}/plaid/sync", headers=L, timeout=90)
            assert s.status_code == 200, s.text
            imported += s.json()["imported"]
            print("sync ->", s.json())
            if imported >= 1:
                break
        assert imported >= 1, "Sandbox deposit never imported"
        _, after = bank_rows()
        new = [x for x in after if x["id"] not in before_ids]
        print("new rows:", new)
        assert any(x["id"].startswith("plaid:") and abs(x["amount"] - amt) < 0.01 for x in new)
        row = next(x for x in new if abs(x["amount"] - amt) < 0.01)
        assert row.get("source") == "plaid"
        assert row["status"] in ("matched", "review")
        # Re-sync: no duplicates
        s2 = requests.post(f"{API}/plaid/sync", headers=L, timeout=90).json()
        _, after2 = bank_rows()
        ids = [x["id"] for x in after2]
        assert len(ids) == len(set(ids)), "duplicate bank txn ids"
        assert len([x for x in after2 if abs(x["amount"] - amt) < 0.01 and x["id"].startswith("plaid:")]) == 1
        print("re-sync ->", s2)

    def test_deposit_missing_amount_validation(self):
        r = requests.post(f"{API}/plaid/sandbox/deposit", headers=L, json={"sender_name": "x"}, timeout=60)
        print(r.status_code, r.text[:200])
        assert r.status_code in (400, 422), f"expected validation error, got {r.status_code}"
