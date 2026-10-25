# Shared demo admin toggle: non-admin 403; friend can act as the admin's Hank only while on.
import os, uuid, asyncio
from datetime import datetime, timedelta, timezone
import pytest, requests
from pymongo import MongoClient
from dotenv import load_dotenv
from test_rentwise_api import B

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
ADMIN = [e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "rishiyashvanth@gmail.com").split(",") if e.strip()][0]
FRIEND = {"Authorization": "Bearer test-landlord-token"}


@pytest.fixture(scope="module")
def admin():
    """Session for an admin account; creates a throwaway admin + sample home if the real one hasn't signed up yet."""
    u = db.users.find_one({"email": ADMIN, "is_sample": {"$ne": True}})
    created = not u
    if created:
        u = {"id": "adm" + uuid.uuid4().hex[:12], "email": ADMIN, "name": "Admin Test", "picture": None, "role": "landlord", "is_sample": False, "created_at": datetime.now(timezone.utc).isoformat()}
        db.users.insert_one(dict(u))
    tok = "test-admin-" + uuid.uuid4().hex
    db.sessions.insert_one({"token": tok, "user_id": u["id"], "expires_at": datetime.now(timezone.utc) + timedelta(hours=1), "created_at": datetime.now(timezone.utc).isoformat()})
    h = {"Authorization": f"Bearer {tok}"}
    before = (db.app_settings.find_one({"key": "shared_demo"}) or {}).get("on", False)
    if created:
        assert requests.post(f"{B}/sample/reset", headers=h, timeout=60).status_code == 200
    hank = db.users.find_one({"is_sample": True, "sample_owner_id": u["id"], "role": "handyman"})
    if not hank:
        pytest.skip("admin has no sample handyman")
    yield {"h": h, "user": u, "hank": hank["id"]}
    db.app_settings.update_one({"key": "shared_demo"}, {"$set": {"on": before}}, upsert=True)
    db.sessions.delete_one({"token": tok})
    if created:
        import sys; sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
        from data import wipe_sample
        asyncio.run(wipe_sample(u["id"]))
        db.users.delete_one({"id": u["id"]})


def test_me_flags(admin):
    assert requests.get(f"{B}/auth/me", headers=admin["h"]).json()["is_admin"] is True
    assert requests.get(f"{B}/auth/me", headers=FRIEND).json()["is_admin"] is False


def test_non_admin_cannot_toggle():
    assert requests.post(f"{B}/admin/shared-demo", json={"on": True}, headers=FRIEND).status_code == 403


def test_friend_acts_as_admin_hank_only_while_on(admin):
    me = lambda: requests.get(f"{B}/auth/me", headers={**FRIEND, "X-Act-As": admin["hank"]})
    assert requests.post(f"{B}/admin/shared-demo", json={"on": False}, headers=admin["h"]).json() == {"on": False}
    assert me().status_code == 403
    assert admin["hank"] not in [p["id"] for p in requests.get(f"{B}/sample/people", headers=FRIEND).json()]

    assert requests.post(f"{B}/admin/shared-demo", json={"on": True}, headers=admin["h"]).json() == {"on": True}
    r = me()
    assert r.status_code == 200 and r.json()["user"]["id"] == admin["hank"] and r.json()["acting"] is True
    people = requests.get(f"{B}/sample/people", headers=FRIEND).json()
    shared = [p for p in people if p["shared"]]
    assert admin["hank"] in [p["id"] for p in shared]
    assert shared and all(p["shared"] for p in people), "friend sees only the shared demo people"

    assert requests.post(f"{B}/admin/shared-demo", json={"on": False}, headers=admin["h"]).status_code == 200
    assert me().status_code == 403
