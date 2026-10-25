"""Plaid Transfer rent payments (sandbox, live, via public URL): connect/disconnect, role gating, error paths, token hiding.
Requires the demo tenant (Tom) to have rent due and no bank connected at start (POST /api/sample/reset + backend restart)."""
import os
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL")).rstrip("/")
API = BASE_URL + "/api"
H = lambda r: {"Authorization": f"Bearer test-{r}-token"}  # noqa: E731


def due(role="tenant"):
    return requests.get(f"{API}/tenant/payments", headers=H(role), timeout=30).json().get("next_due")


# --- role gating ---
class TestRoles:
    def test_handyman_connect_403(self):
        r = requests.post(f"{API}/bank/connect", headers=H("handyman"), timeout=60)
        assert r.status_code == 403
        assert "tenants and landlords" in r.json()["detail"]

    def test_new_user_connect_403(self):
        r = requests.post(f"{API}/bank/connect", headers=H("new"), timeout=60)
        assert r.status_code == 403

    def test_unauth_401(self):
        assert requests.get(f"{API}/bank/me", timeout=20).status_code == 401


# --- connect / disconnect + no token leakage ---
class TestConnect:
    def test_landlord_connect_hides_token(self):
        r = requests.post(f"{API}/bank/connect", headers=H("landlord"), timeout=90)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j == {"connected": True, "bank": "First Platypus Bank (test)", "mask": j["mask"], "name": j["name"]}
        assert "access" not in r.text and "item_id" not in r.text and "account_id" not in r.text
        me = requests.get(f"{API}/bank/me", headers=H("landlord"), timeout=20)
        assert me.json()["connected"] and "access" not in me.text

    def test_tenant_disconnect_then_me(self):
        r = requests.post(f"{API}/bank/disconnect", headers=H("tenant"), timeout=20)
        assert r.status_code == 200 and r.json() == {"connected": False}
        assert requests.get(f"{API}/bank/me", headers=H("tenant"), timeout=20).json() == {"connected": False}


# --- error paths on pay by bank ---
class TestPayErrors:
    def test_no_tenant_bank_409(self):
        if not due():
            pytest.skip("nothing due for tenant")
        requests.post(f"{API}/bank/disconnect", headers=H("tenant"), timeout=20)
        r = requests.post(f"{API}/rent/pay", json={"kind": "rent", "method": "bank"}, headers=H("tenant"), timeout=60)
        assert r.status_code == 409 and r.json()["detail"] == "Connect your bank first"
        assert due() is not None  # nothing recorded

    def test_no_landlord_bank_409_then_reconnect(self):
        if not due():
            pytest.skip("nothing due for tenant")
        assert requests.post(f"{API}/bank/connect", headers=H("tenant"), timeout=90).status_code == 200
        requests.post(f"{API}/bank/disconnect", headers=H("landlord"), timeout=20)
        try:
            r = requests.post(f"{API}/rent/pay", json={"kind": "rent", "method": "bank"}, headers=H("tenant"), timeout=60)
            assert r.status_code == 409 and r.json()["detail"] == "Your landlord hasn't connected a bank for payouts yet"
            # lock must be released: a 2nd try returns the same 409, not "already being processed"
            r2 = requests.post(f"{API}/rent/pay", json={"kind": "rent", "method": "bank"}, headers=H("tenant"), timeout=60)
            assert r2.status_code == 409 and "landlord" in r2.json()["detail"]
        finally:
            assert requests.post(f"{API}/bank/connect", headers=H("landlord"), timeout=90).status_code == 200
        assert due() is not None

    def test_transfers_list_hides_tokens(self):
        for role in ("landlord", "tenant"):
            r = requests.get(f"{API}/bank/transfers", headers=H(role), timeout=20)
            assert r.status_code == 200 and isinstance(r.json(), list)
            assert "access-sandbox" not in r.text and "access_token" not in r.text
