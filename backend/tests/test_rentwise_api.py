# Doorman end-to-end API regression tests (auth, repair flow, self-fix, privacy, money, leases, sample/act-as)
import os, time, io, datetime as dt
import pytest, requests

def _base():
    url = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    if not url:
        for line in open("/app/frontend/.env"):
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                url = line.split("=", 1)[1].strip().strip('"')
    return url.rstrip("/") + "/api"

B = _base()
S = {}  # shared state across ordered tests

def h(tok, **extra):
    d = {"Authorization": f"Bearer test-{tok}-token"}
    d.update(extra)
    return d

def get(tok, path, **kw): return requests.get(B + path, headers=h(tok, **kw.pop("hx", {})), timeout=30, **kw)
def post(tok, path, js=None, **kw): return requests.post(B + path, json=js if js is not None else {}, headers=h(tok, **kw.pop("hx", {})), timeout=60, **kw)

def wait_idle(tok, tid, limit=90):
    t0 = time.time()
    time.sleep(2)
    while time.time() - t0 < limit:
        r = get(tok, f"/threads/{tid}")
        if r.status_code == 200 and not r.json()["thread"].get("busy"):
            return r.json()
        time.sleep(2)
    raise AssertionError("agent still busy")

def upload(tok, name, content):
    r = requests.post(B + "/upload", headers=h(tok), files={"file": (name, io.BytesIO(content), "image/png")}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()

PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000" "1f15c4890000000d49444154789c6300010000050001" "0d0a2db40000000049454e44ae426082")

def tenant_tickets(tok="tenant"):
    r = get(tok, "/tickets"); assert r.status_code == 200
    d = r.json()
    return d if isinstance(d, list) else d.get("tickets", d.get("open", []) + d.get("closed", []))

S["tom_thread"] = requests.get(B + "/threads/mine", headers=h("tenant"), timeout=30).json()["id"]
# resolve sample ids dynamically (POST /sample/reset regenerates them)
PEOPLE = {p["name"].split()[0]: p["id"] for p in requests.get(B + "/sample/people", headers=h("landlord"), timeout=30).json()}
_PID = requests.get(B + "/properties", headers=h("landlord"), timeout=30).json()[0]["id"]
UNITS = {u["label"]: u["id"] for u in requests.get(B + f"/properties/{_PID}", headers=h("landlord"), timeout=30).json()["units"]}

# ---- auth & role gating
class TestAuth:
    @pytest.mark.parametrize("tok,role", [("landlord", "landlord"), ("tenant", "tenant"), ("tenant2", "tenant"), ("handyman", "handyman"), ("new", None)])
    def test_me(self, tok, role):
        r = get(tok, "/auth/me"); assert r.status_code == 200
        assert r.json()["user"]["role"] == role

    def test_no_token_401(self):
        assert requests.get(B + "/auth/me").status_code == 401

    def test_tenant_cannot_landlord_home(self):
        assert get("tenant", "/landlord/home").status_code == 403

# ---- repair happy path
class TestRepairFlow:
    def test_01_tenant_reports_leak(self):
        th = get("tenant", "/threads/mine").json(); S["tom_thread"] = th["id"]
        for t in tenant_tickets():  # agent de-dups open issues, so cancel leftovers first
            if t["status"] not in ("closed", "cancelled"):
                post("tenant", f"/tickets/{t['id']}/cancel")
        before = {t["id"] for t in tenant_tickets()}
        r = post("tenant", f"/threads/{th['id']}/messages", {"text": "The bathroom sink is leaking under the cabinet, slow drip, no photo"})
        assert r.status_code == 200, r.text
        wait_idle("tenant", th["id"])
        new = [t for t in tenant_tickets() if t["id"] not in before]
        assert new, "no ticket created"
        S["tid"] = new[0]["id"]

    def test_02_hank_offer_hides_address(self):
        offers = get("handyman", "/handyman/jobs").json()["offers"]
        o = [x for x in offers if x["id"] == S["tid"]]
        assert o, f"ticket not offered to Hank: {[x['id'] for x in offers]}"
        assert o[0].get("address") is None

    def test_03_accept_quote(self):
        now = dt.datetime.now(dt.timezone.utc)
        base = (now + dt.timedelta(days=1)).replace(hour=17, minute=0, second=0, microsecond=0)  # 10am PT
        slots = [(base + dt.timedelta(hours=i)).isoformat() for i in (0, 2)]
        S["slots"] = slots
        r = post("handyman", f"/tickets/{S['tid']}/accept", {"quote": 150, "slots": slots}); assert r.status_code == 200, r.text

    def test_04_landlord_approves_quote_once(self):
        time.sleep(2)
        aps = [a for a in get("landlord", "/landlord/home").json()["approvals"] if a.get("ticket_id") == S["tid"]]
        assert aps, "no quote approval"
        aid = aps[0]["id"]
        r = post("landlord", f"/approvals/{aid}/decide", {"action": "approve"}); assert r.status_code == 200, r.text
        assert post("landlord", f"/approvals/{aid}/decide", {"action": "approve"}).status_code == 409

    def test_05_tenant_picks_slot(self):
        time.sleep(2)
        t = get("tenant", f"/tickets/{S['tid']}").json()
        t = t.get("ticket", t)
        slot = (t.get("slots") or S["slots"])[0]
        slot = slot["iso"] if isinstance(slot, dict) else slot
        r = post("tenant", f"/tickets/{S['tid']}/pick-slot", {"slot": slot}); assert r.status_code == 200, r.text
        t = get("handyman", f"/tickets/{S['tid']}").json(); t = t.get("ticket", t)
        assert t["status"] == "booked"
        assert t.get("address"), "handyman should see address after booking"

    def test_06_mark_fixed_confirm_pay(self):
        f = upload("handyman", "after.png", PNG + os.urandom(8))
        r = post("handyman", f"/tickets/{S['tid']}/mark-fixed", {"final_amount": 150, "after_photo_id": f["id"]}); assert r.status_code == 200, r.text
        r = post("tenant", f"/tickets/{S['tid']}/confirm", {"ok": True}); assert r.status_code == 200, r.text
        time.sleep(2)
        aps = [a for a in get("landlord", "/landlord/home").json()["approvals"] if a.get("ticket_id") == S["tid"]]
        assert aps, "no pay approval"
        r = post("landlord", f"/approvals/{aps[0]['id']}/decide", {"action": "approve"}); assert r.status_code == 200, r.text
        t = get("landlord", f"/tickets/{S['tid']}").json(); t = t.get("ticket", t)
        assert t["status"] == "closed"
        pid = get("landlord", "/properties").json()[0]["id"]; S["pid"] = pid
        rep = get("landlord", f"/reports/{pid}").json()
        S["report"] = rep
        assert "Repairs" in str(rep) and "150" in str(rep)

# ---- privacy
class TestPrivacy:
    def test_maria_cannot_see_tom_ticket(self):
        assert get("tenant2", f"/tickets/{S['tid']}").status_code in (403, 404)
    def test_maria_cannot_read_tom_thread(self):
        assert get("tenant2", f"/threads/{S['tom_thread']}").status_code in (403, 404)

# ---- decline path
class TestDecline:
    def test_decline_moves_on(self):
        th = S["tom_thread"]; before = {t["id"] for t in tenant_tickets()}
        post("tenant", f"/threads/{th}/messages", {"text": "The kitchen faucet is dripping constantly, no photo"})
        wait_idle("tenant", th)
        new = [t for t in tenant_tickets() if t["id"] not in before]
        assert new, "no ticket"
        tid = new[0]["id"]; S["decline_tid"] = tid
        r = post("handyman", f"/tickets/{tid}/decline"); assert r.status_code == 200, r.text
        time.sleep(3)
        t = get("landlord", f"/tickets/{tid}").json(); t = t.get("ticket", t)
        S["decline_ticket"] = t
        assert t.get("handyman_id") != PEOPLE["Hank"] or t["status"] in ("self_fix_pending", "needs_landlord"), t
        post("tenant", f"/tickets/{tid}/cancel")

# ---- self fix + reimbursement credit
class TestSelfFix:
    def test_self_fix_flow(self):
        th = S["tom_thread"]; before = {t["id"] for t in tenant_tickets()}
        post("tenant", f"/threads/{th}/messages", {"text": "The window blinds in my room are broken, the slats fell off the bracket, no photo"})
        wait_idle("tenant", th)
        new = [t for t in tenant_tickets() if t["id"] not in before]
        assert new, "no ticket"
        tid = new[0]["id"]; S["sf_tid"] = tid
        time.sleep(2)
        aps = [a for a in get("landlord", "/landlord/home").json()["approvals"] if a.get("ticket_id") == tid]
        assert aps and aps[0]["kind"] == "self_fix_limit", aps
        assert post("landlord", f"/approvals/{aps[0]['id']}/decide", {"action": "approve"}).status_code == 200
        rc = upload("tenant", "receipt.png", PNG + b"receipt-unique-" + os.urandom(6)); S["receipt"] = rc
        ph = upload("tenant", "after.png", PNG + os.urandom(6))
        r = post("tenant", f"/tickets/{tid}/receipt", {"receipt_id": rc["id"], "after_photo_id": ph["id"], "amount": 35}); assert r.status_code == 200, r.text
        time.sleep(2)
        aps = [a for a in get("landlord", "/landlord/home").json()["approvals"] if a.get("ticket_id") == tid]
        assert aps, "no reimbursement approval"
        assert post("landlord", f"/approvals/{aps[0]['id']}/decide", {"action": "approve"}).status_code == 200
        pay = get("tenant", "/tenant/payments").json()
        assert "credit" in str(pay).lower() and "35" in str(pay)

    def test_receipt_reuse_409(self):
        th = S["tom_thread"]; before = {t["id"] for t in tenant_tickets()}
        post("tenant", f"/threads/{th}/messages", {"text": "The closet door handle in my room fell off"})
        wait_idle("tenant", th)
        new = [t for t in tenant_tickets() if t["id"] not in before] or [t for t in tenant_tickets() if t["status"] not in ("closed", "cancelled")]
        if not new: pytest.skip("no second ticket created")
        tid = new[0]["id"]
        time.sleep(2)
        aps = [a for a in get("landlord", "/landlord/home").json()["approvals"] if a.get("ticket_id") == tid]
        if aps and aps[0]["kind"] == "self_fix_limit":
            post("landlord", f"/approvals/{aps[0]['id']}/decide", {"action": "approve"})
        else:
            post("tenant", f"/tickets/{tid}/self-fix")
        r = post("tenant", f"/tickets/{tid}/receipt", {"receipt_id": S["receipt"]["id"], "after_photo_id": upload("tenant", "a2.png", PNG + os.urandom(6))["id"], "amount": 35})
        post("tenant", f"/tickets/{tid}/cancel")
        assert r.status_code == 409, r.text

# ---- off-topic
class TestOffTopic:
    def test_pasta_refusal(self):
        th = S.get("tom_thread") or get("tenant", "/threads/mine").json()["id"]
        post("tenant", f"/threads/{th}/messages", {"text": "What's a good pasta recipe?"})
        d = wait_idle("tenant", th)
        last = [m for m in d["messages"] if m.get("sender_role") != "tenant" and m.get("role") != "tenant"][-1]
        txt = last.get("text") or last.get("body") or ""
        S["pasta"] = txt
        assert len(txt) < 300 and "boil" not in txt.lower(), txt

# ---- money
class TestMoney:
    def test_rent_pay_twice(self):
        r = post("tenant", "/rent/pay", {"kind": "rent"}); assert r.status_code in (200, 409), r.text  # 409 if already paid this month
        assert post("tenant", "/rent/pay", {"kind": "rent"}).status_code == 409

    def test_bank_connect_sim_assign(self):
        assert get("landlord", "/money/bank").status_code == 200
        # The demo "connect bank" endpoint was removed (Plaid is the only connect path).
        assert post("landlord", "/money/bank/connect", {"bank": "Chase"}).status_code in (404, 405)
        r = post("landlord", "/money/bank/simulate", {"sender_name": "Maria Lopez", "amount": 50}); assert r.status_code == 200, r.text
        rev = get("landlord", "/money/bank").json()["review"]
        if rev:
            r = post("landlord", f"/money/bank/{rev[0]['id']}/assign", {"tenant_id": PEOPLE["Maria"]})
            assert r.status_code in (200, 400), r.text

    def test_cash_and_expense(self):
        r = post("landlord", "/money/cash", {"unit_id": UNITS["Room B"], "amount": 20}); assert r.status_code in (200, 409), r.text
        pid = get("landlord", "/properties").json()[0]["id"]
        r = post("landlord", "/money/expenses", {"property_id": pid, "amount": 42.5, "category": "Supplies", "description": "TEST_light bulbs"})
        assert r.status_code == 200 and r.json()["amount"] == 42.5

    def test_report_and_csv(self):
        pid = get("landlord", "/properties").json()[0]["id"]
        rep = get("landlord", f"/reports/{pid}").json()
        S["report"] = rep
        assert "deposit" in str(rep).lower()
        r = get("landlord", f"/reports/{pid}/export", params={"fmt": "csv"})
        assert r.status_code == 200 and "," in r.text

# ---- leases
class TestLeases:
    def test_invite_and_lease(self):
        r = post("landlord", f"/units/{UNITS['Room C']}/invite", {"email": "test_roomc@example.com"}); assert r.status_code == 200, r.text
        r = post("landlord", "/leases", {"unit_id": UNITS["Room C"], "terms": {"rent": 1000, "deposit": 3000, "start": "2026-11-01", "end": "2027-10-31"}})
        assert r.status_code == 200, r.text
        S["lease"] = r.json()
        rules = get("landlord", "/state-rules/CA").json()
        S["ca_rules"] = rules
        assert "deposit" in str(rules).lower()

# ---- sample act-as
class TestSample:
    def test_act_as_tom(self):
        r = get("landlord", "/auth/me", hx={"X-Act-As": PEOPLE["Tom"]}); assert r.status_code == 200
        assert r.json()["user"]["name"] == "Tom Chen"
    def test_act_as_non_sample_403(self):
        assert get("landlord", "/auth/me", hx={"X-Act-As": "d3b48a805c404356"}).status_code == 403
    def test_act_as_cannot_approve(self):
        r = post("landlord", "/approvals/x/decide", {"action": "approve"}, hx={"X-Act-As": PEOPLE["Tom"]})
        assert r.status_code == 403

# ---- file visibility: after-photo uploaded by handyman must be viewable by landlord & tenant (KNOWN BUG iteration_1)
class TestAfterPhotoVisibility:
    def test_after_photo_visible_to_landlord(self):
        th = S["tom_thread"]
        for t in tenant_tickets():
            if t["status"] not in ("closed", "cancelled"):
                post("tenant", f"/tickets/{t['id']}/cancel")
        before = {t["id"] for t in tenant_tickets()}
        post("tenant", f"/threads/{th}/messages", {"text": "The bathtub faucet handle is loose and drips, no photo"})
        wait_idle("tenant", th)
        new = [t for t in tenant_tickets() if t["id"] not in before]
        if not new: pytest.skip("no ticket created")
        tid = new[0]["id"]
        slot = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)).replace(hour=17, minute=0, second=0, microsecond=0).isoformat()
        assert post("handyman", f"/tickets/{tid}/accept", {"quote": 100, "slots": [slot]}).status_code == 200
        time.sleep(1)
        a = [a for a in get("landlord", "/landlord/home").json()["approvals"] if a.get("ticket_id") == tid][0]
        post("landlord", f"/approvals/{a['id']}/decide", {"action": "approve"})
        post("tenant", f"/tickets/{tid}/pick-slot", {"slot": slot})
        f = upload("handyman", "after.png", PNG + os.urandom(8))
        post("handyman", f"/tickets/{tid}/mark-fixed", {"final_amount": 100, "after_photo_id": f["id"]})
        ll = get("landlord", f"/files/{f['id']}").status_code
        tn = get("tenant", f"/files/{f['id']}").status_code
        post("tenant", f"/tickets/{tid}/cancel")
        assert (ll, tn) == (200, 200), f"landlord={ll} tenant={tn}"
