"""Iteration 18: Plaid Transfer failure/retry safety, receipt wording, disconnect → Plaid /item/remove.
Needs a fresh state: POST /api/sample/reset (landlord) + backend restart, landlord payout bank connected. Run with -n 0, in file order."""
import io
import json
import os
import pytest
import requests
import httpx
from pymongo import MongoClient
from dotenv import dotenv_values
from pypdf import PdfReader

BASE = os.environ.get("EXPO_BACKEND_URL").rstrip("/") + "/api"
ENV = dotenv_values("/app/backend/.env")
DB = MongoClient(ENV["MONGO_URL"])[ENV["DB_NAME"]]
T = {"Authorization": "Bearer test-tenant-token"}
L = {"Authorization": "Bearer test-landlord-token"}
PLAID = "https://sandbox.plaid.com"


def plaid(path, payload):
    r = httpx.post(PLAID + path, json=payload, timeout=30,
                   headers={"PLAID-CLIENT-ID": ENV["PLAID_CLIENT_ID"], "PLAID-SECRET": ENV["PLAID_SECRET"]})
    return r.status_code, r.json()


def tom_id():
    return requests.get(f"{BASE}/auth/me", headers=T).json()["user"]["id"]


def link_poor_bank(uid):
    """Default sandbox user_good: checking has $100 available → $1,200 rent is declined NSF."""
    _, pt = plaid("/sandbox/public_token/create", {"institution_id": "ins_109508", "initial_products": ["auth", "transfer"]})
    _, ex = plaid("/item/public_token/exchange", {"public_token": pt["public_token"]})
    _, acc = plaid("/auth/get", {"access_token": ex["access_token"]})
    a = next(x for x in acc["accounts"] if x.get("subtype") == "checking")
    DB.bank_links.update_one({"user_id": uid}, {"$set": {"user_id": uid, "role": "tenant", "item_id": ex["item_id"], "access_token": ex["access_token"],
                                                         "account_id": a["account_id"], "mask": a.get("mask"), "name": a.get("name"), "bank": "Poor test bank"}}, upsert=True)


@pytest.fixture(scope="module", autouse=True)
def landlord_bank():
    r = requests.post(f"{BASE}/bank/connect", headers=L)
    assert r.status_code == 200 and r.json()["connected"]


# Disconnect removes the Plaid item too
def test_disconnect_removes_plaid_item():
    assert requests.post(f"{BASE}/bank/connect", headers=T).json()["connected"] is True
    tok = DB.bank_links.find_one({"user_id": tom_id()})["access_token"]
    r = requests.post(f"{BASE}/bank/disconnect", headers=T)
    assert r.status_code == 200 and r.json() == {"connected": False}
    assert requests.get(f"{BASE}/bank/me", headers=T).json() == {"connected": False}
    code, d = plaid("/item/get", {"access_token": tok})
    assert code >= 400 and d.get("error_code") in ("ITEM_NOT_FOUND", "INVALID_ACCESS_TOKEN"), d


# Declined debit → transfer marked failed, not left 'started'
def test_declined_marks_failed():
    link_poor_bank(tom_id())
    r = requests.post(f"{BASE}/rent/pay", headers=T, json={"kind": "rent", "method": "bank"})
    assert r.status_code == 402, r.text
    assert "not enough money" in r.json()["detail"]
    xs = requests.get(f"{BASE}/bank/transfers", headers=T).json()
    assert xs[0]["status"] == "failed" and "not enough money" in xs[0].get("error", "")
    assert not [x for x in xs if x["status"] == "started"]
    assert "access_token" not in json.dumps(xs)
    # lock released → a retry isn't blocked with 'already being processed'
    r2 = requests.post(f"{BASE}/rent/pay", headers=T, json={"kind": "rent", "method": "bank"})
    assert r2.status_code == 402, r2.text


# Retry with the same stable key after a decline, now with money → goes through (decline isn't locked in by idempotency)
def test_retry_after_decline_pays():
    assert requests.post(f"{BASE}/bank/connect", headers=T).json()["mask"] == "0000"
    r = requests.post(f"{BASE}/rent/pay", headers=T, json={"kind": "rent", "method": "bank"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["transfer"]["status"] == "paid_out" and "••0000" in d["transfer"]["from"]
    pytest.pid = d["payment"]["id"]
    xs = requests.get(f"{BASE}/bank/transfers", headers=T).json()
    assert [x["status"] for x in xs].count("paid_out") == 1
    assert xs[0]["payment_id"] == pytest.pid


# Receipt PDF wording for a Plaid payment
def test_receipt_says_plaid():
    if not getattr(pytest, "pid", None):
        pytest.skip("needs a Plaid payment from test_retry_after_decline_pays")
    r = requests.get(f"{BASE}/receipts/{pytest.pid}.pdf", headers=T)
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/pdf")
    txt = " ".join(p.extract_text() for p in PdfReader(io.BytesIO(r.content)).pages)
    assert "Paid by bank transfer through Plaid (sandbox test money)." in " ".join(txt.split()), txt
