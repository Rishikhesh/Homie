"""Plaid Transfer (sandbox, live API): tenant + landlord connect test banks, one tap moves rent, the books record it."""
import os
import requests
from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
API = os.environ.get("EVAL_BASE_URL", "http://localhost:8001").rstrip("/") + "/api"
H = lambda r: {"Authorization": f"Bearer test-{r}-token"}  # noqa: E731


def test_connect_requires_role_and_hides_tokens():
    r = requests.post(f"{API}/bank/connect", headers=H("handyman"), timeout=60)
    assert r.status_code == 403
    r = requests.post(f"{API}/bank/connect", headers=H("landlord"), timeout=60)
    assert r.status_code == 200 and r.json()["connected"] and "access_token" not in r.text
    assert requests.get(f"{API}/bank/me", headers=H("landlord"), timeout=20).json()["connected"]


def test_pay_by_bank_needs_tenant_bank():
    requests.post(f"{API}/bank/disconnect", headers=H("tenant"), timeout=20)
    r = requests.post(f"{API}/rent/pay", json={"kind": "rent", "method": "bank"}, headers=H("tenant"), timeout=60)
    assert r.status_code in (409,), r.text


def test_one_tap_transfer_records_payment():
    requests.post(f"{API}/bank/connect", headers=H("landlord"), timeout=60)
    assert requests.post(f"{API}/bank/connect", headers=H("tenant"), timeout=60).status_code == 200
    r = requests.post(f"{API}/rent/pay", json={"kind": "rent", "method": "bank"}, headers=H("tenant"), timeout=120)
    if r.status_code == 409 and "Nothing is due" in r.text:
        return  # demo already paid up this month
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["transfer"] and j["transfer"]["status"] in ("paid_out", "payout_pending")
    assert j["payment"] and j["payment"]["amount"] > 0
    ts = requests.get(f"{API}/bank/transfers", headers=H("landlord"), timeout=20).json()
    assert any(t["id"] == j["transfer"]["id"] and t["debit_id"] for t in ts)
