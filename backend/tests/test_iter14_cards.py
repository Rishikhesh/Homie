# Iteration 14: chat doc card fallback (agent placeholder ref like "lease") + receipt names never ISO
import os
import re
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", os.environ.get("EXPO_BACKEND_URL", "")).rstrip("/")
T = {"Authorization": "Bearer test-tenant-token"}
T2 = {"Authorization": "Bearer test-tenant2-token"}
L = {"Authorization": "Bearer test-landlord-token"}


# doc card: omitted ref → own lease
def test_doc_card_no_ref():
    r = requests.get(f"{BASE_URL}/api/cards/doc/-", headers=T, timeout=20)
    assert r.status_code == 200
    assert r.json()["route"].startswith("/lease/")


# doc card: placeholder ref "lease" (what the agent actually sends) → own lease, not 403
def test_doc_card_placeholder_ref():
    a = requests.get(f"{BASE_URL}/api/cards/doc/lease", headers=T, timeout=20).json()
    b = requests.get(f"{BASE_URL}/api/cards/doc/lease", headers=T2, timeout=20).json()
    assert a["name"] == "Lease" and b["name"] == "Lease"
    assert a["route"] != b["route"]  # each tenant gets their own lease, no leak


# doc card: unknown ref for a landlord (no own lease) → 403
def test_doc_card_landlord_placeholder_denied():
    r = requests.get(f"{BASE_URL}/api/cards/doc/lease", headers=L, timeout=20)
    assert r.status_code == 403


# receipt doc names show a month name, not "2026-10"
def test_receipt_name_not_iso():
    pays = requests.get(f"{BASE_URL}/api/tenant/payments", headers=T, timeout=20).json()
    items = pays if isinstance(pays, list) else (pays.get("payments") or pays.get("items") or [])
    ids = [p["id"] for p in items if isinstance(p, dict) and p.get("id")]
    if not ids:
        import pytest
        pytest.skip("no payments listed for tenant via /api/payments")
    r = requests.get(f"{BASE_URL}/api/cards/doc/{ids[0]}", headers=T, timeout=20)
    assert r.status_code == 200
    assert not re.search(r"\d{4}-\d{2}", r.json()["name"])
