"""Iteration 18: a retry after 'money moved but payment not recorded' reuses the transfer (same key), never charges twice.
Needs a fresh reset + restart (Tom has rent due). Run alone with -n 0."""
import requests
from test_transfers_retry import BASE, DB, T, L, tom_id, link_poor_bank


def test_retry_reuses_debited_transfer():
    assert requests.post(f"{BASE}/bank/connect", headers=L).status_code == 200
    link_poor_bank(tom_id())
    assert requests.post(f"{BASE}/rent/pay", headers=T, json={"kind": "rent", "method": "bank"}).status_code == 402
    failed = requests.get(f"{BASE}/bank/transfers", headers=T).json()[0]
    # simulate a crash after the debit: a debited transfer with this key and no payment
    fake = {**failed, "id": "TEST_reuse_xfer", "status": "debited", "debit_id": "TEST_debit", "payment_id": None, "created_at": "2099-01-01T00:00:00+00:00"}
    fake.pop("error", None)
    DB.transfers.insert_one(dict(fake))
    assert requests.post(f"{BASE}/bank/connect", headers=T).status_code == 200
    n = DB.transfers.count_documents({"tenant_id": failed["tenant_id"]})
    r = requests.post(f"{BASE}/rent/pay", headers=T, json={"kind": "rent", "method": "bank"})
    assert r.status_code == 200, r.text
    assert r.json()["transfer"]["id"] == "TEST_reuse_xfer"
    assert DB.transfers.count_documents({"tenant_id": failed["tenant_id"]}) == n  # no new charge
    assert DB.transfers.find_one({"id": "TEST_reuse_xfer"})["payment_id"] == r.json()["payment"]["id"]
