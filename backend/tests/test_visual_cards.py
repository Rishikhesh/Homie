"""Visual language, agent side: one-line text + details, show_card ownership (403), repair replies always carry a repair card."""
import asyncio, os, sys
from pathlib import Path
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv  # noqa: E402
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
API = os.environ.get("EVAL_BASE_URL", "http://localhost:8001").rstrip("/") + "/api"
H = lambda t: {"Authorization": f"Bearer {t}"}  # noqa: E731


# ---- 1. text over 20 words is split into text (first sentence) + details ----
def test_shorten_splits_long_text():
    from cards import shorten
    long = ("Got it, Hank is on it. I've asked Hank, who fixed your sink in March, and I'll let you know as soon as he replies with a couple of times that work for him.")
    text, details = shorten(long)
    assert text == "Got it, Hank is on it."
    assert details and details.startswith("I've asked Hank")
    assert shorten("Got it. Hank is on it.") == ("Got it. Hank is on it.", None)
    one = " ".join(["word"] * 30)
    t2, d2 = shorten(one)
    assert len(t2.split()) <= 20 and d2


_LOOP = asyncio.new_event_loop()  # motor binds to the first loop it sees


def _run(coro):
    return _LOOP.run_until_complete(coro)


async def _people():
    from core import db, NF
    tom = await db.users.find_one({"name": "Tom Chen"}, NF)
    maria = await db.users.find_one({"name": "Maria Lopez"}, NF)
    t = await db.tickets.find_one({"tenant_id": tom["id"]}, NF)
    th = await db.threads.find_one({"kind": "tenant", "tenant_id": maria["id"]}, NF)
    return tom, maria, t, th


# ---- 2. show_card refuses records the user doesn't own (403) ----
def test_show_card_refuses_other_tenants_records():
    import agent

    async def go():
        tom, maria, t, th = await _people()
        assert t, "seed should have a ticket for Tom"
        th = th or {"id": "x", "kind": "tenant", "tenant_id": maria["id"], "landlord_id": t["landlord_id"]}
        cards = []
        out = await agent.run_tool("show_card", {"type": "repair", "ref_id": t["id"]}, maria, th, cards)
        assert out.get("status") == 403 and not cards, out
        unit = await __import__("core").db.units.find_one({"tenant_id": tom["id"]}, {"_id": 0})
        out2 = await agent.run_tool("show_card", {"type": "rent", "ref_id": unit["id"]}, maria, th, cards)
        assert out2.get("status") == 403 and not cards, out2
    _run(go())


def test_cards_endpoint_403_for_other_tenant():
    tickets = requests.get(f"{API}/tickets", headers=H("test-tenant-token"), timeout=20).json()
    assert tickets, "Tom should have tickets"
    tid = tickets[0]["id"]
    assert requests.get(f"{API}/cards/repair/{tid}", headers=H("test-tenant-token"), timeout=20).status_code == 200
    assert requests.get(f"{API}/cards/repair/{tid}", headers=H("test-tenant2-token"), timeout=20).status_code == 403
    assert requests.get(f"{API}/cards/repair/{tid}", headers=H("test-landlord-token"), timeout=20).status_code == 200


# ---- 3. a repair update message from the agent always carries a repair card (mocked model) ----
class _TC:
    def __init__(self, name, args):
        self.id, self.name, self.arguments = "tc1", name, args


class _Resp:
    def __init__(self, content="", tool_calls=None):
        self.content, self.tool_calls = content, tool_calls or []


class _FakeChat:
    def __init__(self, tid):
        self.turn, self.tid = 0, tid

    def with_tools(self, _):
        return self

    def add_tool_result(self, *_):
        pass

    async def send_message_with_tools(self, *_a, **_k):
        self.turn += 1
        if self.turn == 1:
            return _Resp(tool_calls=[_TC("update_ticket", {"ticket_id": self.tid, "note": "Tenant says it drips at night"})])
        return _Resp("Noted, I've added that for Hank.")


def test_repair_update_reply_has_repair_card(monkeypatch):
    import agent
    from core import db, NF

    async def go():
        tom, _, t, _ = await _people()
        th = await db.threads.find_one({"kind": "tenant", "tenant_id": tom["id"]}, NF)

        async def tri(*_a, **_k):
            return {"in_scope": True}
        monkeypatch.setattr(agent, "triage", tri)
        monkeypatch.setattr(agent, "llm", lambda *a, **k: _FakeChat(t["id"]))
        await agent.run_turn(th["id"], tom, "It drips at night too", [])
        m = await db.messages.find_one({"thread_id": th["id"], "role": "assistant"}, NF, sort=[("created_at", -1)])
        assert m["text"].startswith("Noted")
        assert any(c["type"] == "repair" and c["ref_id"] == t["id"] for c in m["cards"]), m["cards"]
        await db.messages.delete_one({"id": m["id"]})
    _run(go())


def test_fit_line_keeps_questions_visible():
    from cards import fit_line
    t, d = fit_line("Internet is split between rooms and paid by tenants. I don't have the wifi password, ask Jordan.")
    assert t == "Internet is split between rooms and paid by tenants." and d.startswith("I don't")
    t, d = fit_line("Sorry about that, I'm getting someone out. Please send a photo of the faucet. Is water pooling?")
    assert t.endswith("Is water pooling?") and len(t.split()) <= 12
    assert fit_line("Leave now and call 911. Then call PG&E from outside, do not use switches.")[1] is None
    assert fit_line("I've asked Hank, who fixed your sink in March, to fix the alarm.")[0] == "I've asked Hank to fix the alarm."
    assert fit_line("I've asked all three handymen about tomorrow morning and will tell you when they answer.")[0] == "I've asked all three handymen about tomorrow morning."


def test_ensure_repair_cards_dedupes():
    import agent
    assert agent.auto_yes_no("Got it. Is water on the floor?", [])[0]["question"] == "Is water on the floor?"
    assert agent.auto_yes_no("Does it not turn on, or run cold?", []) == []
    cards = [{"type": "choice_time", "ref_id": "a"}]
    agent.ensure_repair_cards(["a", "b", "b"], cards)
    assert cards == [{"type": "choice_time", "ref_id": "a"}, {"type": "repair", "ref_id": "b"}]
