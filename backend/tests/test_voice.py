# Voice feature: TTS for agent replies (GET /api/voice/tts/{id}.mp3) and STT (POST /api/voice/transcribe)
import os, time
import pytest, requests
from dotenv import dotenv_values

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or dotenv_values("/app/frontend/.env")["EXPO_PUBLIC_BACKEND_URL"]).rstrip("/")
API = f"{BASE_URL}/api"
T1, T2, LL, HM = "test-tenant-token", "test-tenant2-token", "test-landlord-token", "test-handyman-token"


def H(t):
    return {"Authorization": f"Bearer {t}"}


def thread_of(tok):
    r = requests.get(f"{API}/threads/mine", headers=H(tok), timeout=20)
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    return tid, requests.get(f"{API}/threads/{tid}", headers=H(tok), timeout=20).json()["messages"]


def media(tok):
    return requests.get(f"{API}/auth/me", headers=H(tok), timeout=20).json()["media_token"]


@pytest.fixture(scope="module")
def tenant_ctx():
    tid, msgs = thread_of(T1)
    agent = [m for m in msgs if m["role"] != "user" and (m.get("text") or "").strip()]
    users = [m for m in msgs if m["role"] == "user"]
    if not agent:
        pytest.skip("no agent message in tenant thread")
    return {"tid": tid, "agent": agent[-1], "user": users[-1] if users else None}


@pytest.fixture(scope="module")
def tts_bytes(tenant_ctx):
    r = requests.get(f"{API}/voice/tts/{tenant_ctx['agent']['id']}.mp3", params={"media": media(T1)}, timeout=60)
    assert r.status_code == 200, r.text[:300]
    return r


# ---- TTS ----
class TestTTS:
    def test_tts_media_token_returns_mp3(self, tts_bytes):
        assert tts_bytes.headers["content-type"].startswith("audio/mpeg")
        assert len(tts_bytes.content) > 2000
        assert tts_bytes.content[:3] == b"ID3" or tts_bytes.content[0] == 0xFF

    def test_tts_cached_second_call_fast_and_identical(self, tenant_ctx, tts_bytes):
        t = time.time()
        r = requests.get(f"{API}/voice/tts/{tenant_ctx['agent']['id']}.mp3", headers=H(T1), timeout=60)
        dt = time.time() - t
        print(f"cached tts in {dt:.2f}s")
        assert r.status_code == 200 and r.content == tts_bytes.content

    def test_tts_user_message_404(self, tenant_ctx):
        if not tenant_ctx["user"]:
            pytest.skip("no user msg")
        r = requests.get(f"{API}/voice/tts/{tenant_ctx['user']['id']}.mp3", headers=H(T1), timeout=20)
        assert r.status_code == 404

    def test_tts_other_tenant_404_bearer(self, tenant_ctx):
        r = requests.get(f"{API}/voice/tts/{tenant_ctx['agent']['id']}.mp3", headers=H(T2), timeout=20)
        assert r.status_code == 404

    def test_tts_other_tenant_404_media(self, tenant_ctx):
        r = requests.get(f"{API}/voice/tts/{tenant_ctx['agent']['id']}.mp3", params={"media": media(T2)}, timeout=20)
        assert r.status_code == 404

    def test_tts_handyman_404(self, tenant_ctx):
        r = requests.get(f"{API}/voice/tts/{tenant_ctx['agent']['id']}.mp3", headers=H(HM), timeout=20)
        assert r.status_code == 404

    def test_tts_landlord_can_read_tenant_thread(self, tenant_ctx):
        r = requests.get(f"{API}/voice/tts/{tenant_ctx['agent']['id']}.mp3", headers=H(LL), timeout=60)
        assert r.status_code == 200 and r.headers["content-type"].startswith("audio/mpeg")

    def test_tts_no_auth_401(self, tenant_ctx):
        r = requests.get(f"{API}/voice/tts/{tenant_ctx['agent']['id']}.mp3", timeout=20)
        assert r.status_code == 401

    def test_tts_login_token_in_query_rejected(self, tenant_ctx):
        r = requests.get(f"{API}/voice/tts/{tenant_ctx['agent']['id']}.mp3", params={"media": T1}, timeout=20)
        assert r.status_code == 401

    def test_tts_unknown_message_404(self):
        r = requests.get(f"{API}/voice/tts/doesnotexist123.mp3", headers=H(T1), timeout=20)
        assert r.status_code == 404


# ---- STT ----
class TestSTT:
    def test_transcribe_real_speech(self, tenant_ctx, tts_bytes):
        r = requests.post(f"{API}/voice/transcribe", headers=H(T1),
                          files={"audio": ("speech.mp3", tts_bytes.content, "audio/mpeg")}, timeout=90)
        assert r.status_code == 200, r.text[:300]
        text = r.json()["text"]
        print("TRANSCRIPT:", text[:200], "| ORIGINAL:", tenant_ctx["agent"]["text"][:200])
        assert len(text) > 5
        orig = set(w.strip(".,!?'\"").lower() for w in tenant_ctx["agent"]["text"].split())
        got = set(w.strip(".,!?'\"").lower() for w in text.split())
        assert len(orig & got) >= min(3, len(orig))

    def test_transcribe_too_short(self):
        r = requests.post(f"{API}/voice/transcribe", headers=H(T1), files={"audio": ("a.m4a", b"\x00" * 100, "audio/m4a")}, timeout=20)
        assert r.status_code == 200 and r.json() == {"text": "", "reason": "too_short"}

    def test_transcribe_no_auth_401(self):
        r = requests.post(f"{API}/voice/transcribe", files={"audio": ("a.m4a", b"\x00" * 5000, "audio/m4a")}, timeout=20)
        assert r.status_code == 401

    def test_transcribe_missing_field_422(self):
        r = requests.post(f"{API}/voice/transcribe", headers=H(T1), files={"file": ("a.m4a", b"\x00" * 5000, "audio/m4a")}, timeout=20)
        assert r.status_code == 422

    def test_transcribe_garbage_audio_graceful(self):
        r = requests.post(f"{API}/voice/transcribe", headers=H(T1), files={"audio": ("a.m4a", os.urandom(5000), "audio/m4a")}, timeout=60)
        print("garbage:", r.status_code, r.text[:200])
        assert r.status_code in (200, 422)


# ---- Regression: chat send + agent reply ----
def test_chat_send_and_agent_reply(tenant_ctx):
    tid = tenant_ctx["tid"]
    for _ in range(10):
        r = requests.post(f"{API}/threads/{tid}/messages", headers=H(T1), json={"text": "TEST_ voice regression: what day is rent due?"}, timeout=20)
        if r.status_code != 409:
            break
        time.sleep(3)
    assert r.status_code == 200, r.text
    mid = r.json()["id"]
    for _ in range(40):
        time.sleep(3)
        d = requests.get(f"{API}/threads/{tid}", headers=H(T1), timeout=20).json()
        ids = [m["id"] for m in d["messages"]]
        after = d["messages"][ids.index(mid) + 1:] if mid in ids else []
        if not d["thread"]["busy"] and any(m["role"] != "user" for m in after):
            reply = [m for m in after if m["role"] != "user"][0]
            print("AGENT:", reply["text"][:200])
            assert reply["text"]
            t = requests.get(f"{API}/voice/tts/{reply['id']}.mp3", headers=H(T1), timeout=60)
            assert t.status_code == 200 and t.headers["content-type"].startswith("audio/mpeg")
            return
    pytest.fail("agent did not reply in 120s")
