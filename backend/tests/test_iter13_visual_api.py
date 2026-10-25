"""Iteration 13: visual-language API checks via public URL (cards ownership, money grid, home payloads)."""
import os
import pytest
import requests

BASE = os.environ.get("EXPO_BACKEND_URL").rstrip("/") + "/api"
H = lambda t: {"Authorization": f"Bearer {t}"}  # noqa: E731


@pytest.fixture(scope="module")
def tom_ticket():
    r = requests.get(f"{BASE}/tickets", headers=H("test-tenant-token"), timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    items = data if isinstance(data, list) else data.get("tickets") or data.get("items") or []
    if not items:
        pytest.skip("Tom has no tickets")
    return items[0]


# Cards: repair card ownership
def test_repair_card_tenant_ok(tom_ticket):
    r = requests.get(f"{BASE}/cards/repair/{tom_ticket['id']}", headers=H("test-tenant-token"), timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["type"] == "repair" and d["ticket_id"] == tom_ticket["id"] and isinstance(d["step"], int)


def test_repair_card_other_tenant_403(tom_ticket):
    r = requests.get(f"{BASE}/cards/repair/{tom_ticket['id']}", headers=H("test-tenant2-token"), timeout=30)
    assert r.status_code == 403


def test_card_unknown_type_400():
    r = requests.get(f"{BASE}/cards/bogus/x", headers=H("test-tenant-token"), timeout=30)
    assert r.status_code == 400


def test_rent_card_tenant():
    r = requests.get(f"{BASE}/cards/rent/-", headers=H("test-tenant-token"), timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["type"] == "rent" and d["amount"] > 0


def test_law_card():
    r = requests.get(f"{BASE}/cards/law/CA", headers=H("test-tenant-token"), timeout=30)
    assert r.status_code == 200
    assert r.json()["state"] == "CA"


# Money grid (landlord)
def test_money_grid_landlord():
    r = requests.get(f"{BASE}/money/grid", headers=H("test-landlord-token"), timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert len(d["periods"]) == 6 and len(d["rows"]) >= 1
    print(d["rows"][0])


def test_money_grid_tenant_forbidden():
    r = requests.get(f"{BASE}/money/grid", headers=H("test-tenant-token"), timeout=30)
    assert r.status_code in (401, 403)


def test_tenant_home_payload():
    r = requests.get(f"{BASE}/tenant/home", headers=H("test-tenant-token"), timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d["unit"] and "tickets" in d and "onboarding" in d


def test_no_auth_401():
    r = requests.get(f"{BASE}/cards/rent/-", timeout=30)
    assert r.status_code == 401
