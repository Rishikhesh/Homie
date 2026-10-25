# Lease upload (signed PDF) feature: upload -> AI extract -> save -> PDF/onboarding/thread/agent
import os
import sys
import time
import pytest
import requests

sys.path.insert(0, "/app/backend")
from data import pdf_bytes  # noqa: E402

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", os.environ.get("EXPO_BACKEND_URL", "")).rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as fh:
        for line in fh:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
API = f"{BASE_URL}/api"
LL = {"Authorization": "Bearer test-landlord-token"}
TN = {"Authorization": "Bearer test-tenant-token"}

LEASE_LINES = [
    "This Residential Lease Agreement is made between Jordan Rivera (Landlord) and Tom Chen (Tenant) for Room A at 12 Maple Ave, San Jose, CA 95112.",
    "1. TERM. The lease begins on 2026-02-01 and ends on 2027-01-31.",
    "2. RENT. Tenant shall pay monthly rent of $1,450.00, due on the 3rd day of each month.",
    "3. SECURITY DEPOSIT. Tenant shall pay a security deposit of $1,450.00 before move-in.",
    "4. LATE FEE. If rent is not received within 5 days of the due date, a late fee of $55.00 will be charged.",
    "5. PETS. Tenant may keep one cat with a written pet agreement. No dogs are allowed on the premises.",
    "6. UTILITIES. Tenant pays a 1/3 share of electric and gas. Landlord pays water, trash and internet.",
    "7. NOTICE. Either party must give 45 days written notice before ending the lease at the end of the term.",
    "8. QUIET HOURS. Quiet hours are 10 pm to 7 am every day. Smoking is not allowed inside the house.",
]


def _upload(headers, data, name="lease.pdf", ctype="application/pdf"):
    r = requests.post(f"{API}/upload", headers=headers, files={"file": (name, data, ctype)}, timeout=60)
    return r


@pytest.fixture(scope="module")
def units():
    r = requests.get(f"{API}/properties", headers=LL, timeout=30)
    assert r.status_code == 200
    pid = r.json()[0]["id"]
    p = requests.get(f"{API}/properties/{pid}", headers=LL, timeout=30).json()
    by = {u["label"]: u for u in p["units"]}
    return by


@pytest.fixture(scope="module")
def pdf():
    return pdf_bytes("Residential Lease Agreement", LEASE_LINES)


@pytest.fixture(scope="module")
def extracted(units, pdf):
    r = _upload(LL, pdf)
    assert r.status_code == 200, r.text
    fid = r.json()["id"]
    t0 = time.time()
    e = requests.post(f"{API}/leases/extract", headers=LL, json={"unit_id": units["Room A"]["id"], "file_id": fid}, timeout=180)
    print(f"extract took {time.time() - t0:.1f}s")
    assert e.status_code == 200, e.text
    return e.json()


class TestExtract:
    def test_extract_terms(self, extracted):
        t = extracted["terms"]
        assert float(t["rent"]) == 1450
        assert float(t["deposit"]) == 1450
        assert t["start"] == "2026-02-01"
        assert t["end"] == "2027-01-31"
        assert int(t["due_day"]) == 3
        assert float(t["late_fee"]) == 55
        assert int(t["notice_days"]) == 45
        assert "cat" in (t.get("pets") or "").lower()
        assert "Tom" in (t.get("tenant_name") or "")
        assert isinstance(t.get("missing", []), list)
        assert t.get("summary")

    def test_extract_chunks(self, extracted):
        ch = extracted["chunks"]
        assert isinstance(ch, list) and len(ch) >= 5
        assert any("cat" in c.lower() for c in ch)

    def test_extract_non_landlord_403(self, units, extracted):
        r = requests.post(f"{API}/leases/extract", headers=TN, json={"unit_id": units["Room A"]["id"], "file_id": extracted["file_id"]}, timeout=30)
        assert r.status_code == 403

    def test_extract_unknown_file_404(self, units):
        r = requests.post(f"{API}/leases/extract", headers=LL, json={"unit_id": units["Room A"]["id"], "file_id": "nope"}, timeout=30)
        assert r.status_code == 404

    def test_extract_non_pdf_415(self, units):
        png = b"\x89PNG\r\n\x1a\n" + b"0" * 100
        fid = _upload(LL, png, "x.png", "image/png").json()["id"]
        r = requests.post(f"{API}/leases/extract", headers=LL, json={"unit_id": units["Room A"]["id"], "file_id": fid}, timeout=30)
        assert r.status_code == 415

    def test_extract_short_pdf_422(self, units):
        fid = _upload(LL, pdf_bytes("Hi", ["short"])).json()["id"]
        r = requests.post(f"{API}/leases/extract", headers=LL, json={"unit_id": units["Room A"]["id"], "file_id": fid}, timeout=30)
        assert r.status_code == 422

    def test_extract_vacant_unit_400(self, units, extracted):
        c = units["Room C"]
        if c.get("tenant_id") or c.get("invite"):
            pytest.skip("Room C not vacant")
        r = requests.post(f"{API}/leases/extract", headers=LL, json={"unit_id": c["id"], "file_id": extracted["file_id"]}, timeout=30)
        assert r.status_code == 400


class TestSave:
    lease = None

    def test_missing_terms_400(self, units, extracted):
        t = {**extracted["terms"], "rent": ""}
        r = requests.post(f"{API}/leases/upload", headers=LL, json={"unit_id": units["Room A"]["id"], "file_id": extracted["file_id"], "terms": t}, timeout=30)
        assert r.status_code == 400
        t = {**extracted["terms"], "start": None}
        r = requests.post(f"{API}/leases/upload", headers=LL, json={"unit_id": units["Room A"]["id"], "file_id": extracted["file_id"], "terms": t}, timeout=30)
        assert r.status_code == 400

    def test_bad_number_400(self, units, extracted):
        t = {**extracted["terms"], "rent": "abc"}
        r = requests.post(f"{API}/leases/upload", headers=LL, json={"unit_id": units["Room A"]["id"], "file_id": extracted["file_id"], "terms": t}, timeout=30)
        assert r.status_code == 400

    def test_save_non_landlord_403(self, units, extracted):
        r = requests.post(f"{API}/leases/upload", headers=TN, json={"unit_id": units["Room A"]["id"], "file_id": extracted["file_id"], "terms": extracted["terms"]}, timeout=30)
        assert r.status_code == 403

    def test_save_signed(self, units, extracted):
        r = requests.post(f"{API}/leases/upload", headers=LL, json={"unit_id": units["Room A"]["id"], "file_id": extracted["file_id"], "terms": extracted["terms"], "chunks": extracted["chunks"]}, timeout=60)
        assert r.status_code == 200, r.text
        le = r.json()
        assert le["status"] == "signed" and le["source"] == "upload"
        assert le["file_id"] == extracted["file_id"]
        assert le["terms"]["rent"] == 1450.0
        assert "_id" not in le
        TestSave.lease = le
        g = requests.get(f"{API}/leases/{le['id']}", headers=LL, timeout=30)
        assert g.status_code == 200 and g.json()["status"] == "signed"

    def test_duplicate_409(self, units, extracted):
        r = requests.post(f"{API}/leases/upload", headers=LL, json={"unit_id": units["Room A"]["id"], "file_id": extracted["file_id"], "terms": extracted["terms"]}, timeout=30)
        assert r.status_code == 409

    def test_pdf_landlord_and_tenant(self, pdf):
        lid = TestSave.lease["id"]
        for h in (LL, TN):
            r = requests.get(f"{API}/leases/{lid}/pdf", headers=h, timeout=30)
            assert r.status_code == 200
            assert r.headers["content-type"].startswith("application/pdf")
            assert r.content == pdf

    def test_pdf_other_tenant_404(self):
        r = requests.get(f"{API}/leases/{TestSave.lease['id']}/pdf", headers={"Authorization": "Bearer test-tenant2-token"}, timeout=30)
        assert r.status_code == 404

    def test_tenant_home_onboarding(self):
        h = requests.get(f"{API}/tenant/home", headers=TN, timeout=30).json()
        assert h["onboarding"]["lease_signed"] is True
        assert h["lease"]["id"] == TestSave.lease["id"]

    def test_tenant_thread_lease_card(self):
        th = requests.get(f"{API}/threads/mine", headers=TN, timeout=30).json()
        msgs = requests.get(f"{API}/threads/{th['id']}", headers=TN, timeout=30).json()["messages"]
        cards = [c for m in msgs for c in (m.get("cards") or []) if c.get("type") == "lease" and c.get("lease_id") == TestSave.lease["id"]]
        assert cards

    def test_tenant_agent_answers_from_lease(self):
        th = requests.get(f"{API}/threads/mine", headers=TN, timeout=30).json()
        tid = th["id"]
        for _ in range(20):
            r = requests.post(f"{API}/threads/{tid}/messages", headers=TN, json={"text": "Can I have a cat?"}, timeout=30)
            if r.status_code != 409:
                break
            time.sleep(3)
        assert r.status_code == 200, r.text
        sent_at = r.json()["created_at"]
        reply = None
        for _ in range(40):
            time.sleep(3)
            msgs = requests.get(f"{API}/threads/{tid}", headers=TN, params={"after": sent_at}, timeout=30).json()["messages"]
            bot = [m for m in msgs if m.get("role") != "user" and m.get("text")]
            if bot:
                reply = " ".join(m["text"] for m in bot)
                th2 = requests.get(f"{API}/threads/{tid}", headers=TN, timeout=30).json()["thread"]
                if not th2.get("busy"):
                    reply = " ".join(m["text"] for m in requests.get(f"{API}/threads/{tid}", headers=TN, params={"after": sent_at}, timeout=30).json()["messages"] if m.get("role") != "user" and m.get("text"))
                    break
        print("AGENT REPLY:", reply)
        assert reply and ("cat" in reply.lower())
        assert "pet agreement" in reply.lower() or "one cat" in reply.lower() or "written" in reply.lower()
