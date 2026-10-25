# Tenant sees whether their landlord can receive bank payments; landlord connecting tells tenants in chat.
import time, requests
from test_rentwise_api import B as API, get


def H(who):
    return {"Authorization": f"Bearer test-{who}-token"}


def _msgs():
    th = get("tenant", "/threads/mine").json()["id"]
    return [m["text"] for m in get("tenant", f"/threads/{th}").json()["messages"]]


def test_landlord_connected_flag_and_chat_message():
    assert requests.post(f"{API}/bank/connect", headers=H("tenant"), timeout=60).status_code == 200
    requests.post(f"{API}/bank/disconnect", headers=H("landlord"), timeout=30)
    me = requests.get(f"{API}/bank/me", headers=H("tenant"), timeout=20).json()
    assert me["connected"] is True and me["landlord_connected"] is False
    r = requests.post(f"{API}/rent/pay", json={"kind": "rent", "method": "bank"}, headers=H("tenant"), timeout=60)
    assert r.status_code == 409  # safety net still in place

    before = _msgs().count("You can now pay rent straight from your bank.")
    assert requests.post(f"{API}/bank/connect", headers=H("landlord"), timeout=60).status_code == 200
    assert requests.get(f"{API}/bank/me", headers=H("tenant"), timeout=20).json()["landlord_connected"] is True
    time.sleep(0.5)
    assert _msgs().count("You can now pay rent straight from your bank.") == before + 1
    # reconnecting doesn't spam tenants
    requests.post(f"{API}/bank/connect", headers=H("landlord"), timeout=60)
    assert _msgs().count("You can now pay rent straight from your bank.") == before + 1
    assert "landlord_connected" not in requests.get(f"{API}/bank/me", headers=H("landlord"), timeout=20).json()
