"""Voice: speech to text for chat input, text to speech for agent replies (Emergent managed OpenAI models)."""
import hashlib, io, re
import emoji
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from emergentintegrations.llm.openai import OpenAISpeechToText, OpenAITextToSpeech
from core import db, NF, LLM_KEY, APP_NAME, get_user, get_media_user, put_object, get_object, log
import asyncio, os

router = APIRouter(prefix="/api")
STT_MODEL = "gpt-4o-mini-transcribe"   # doesn't invent text on silence
TTS_MODEL, TTS_VOICE = "tts-1-hd", "sage"  # higher-quality, calm and composed voice
VOICE_PROVIDER = os.environ.get("VOICE_PROVIDER", "emergent")


async def _emergent_transcribe(data):
    f = io.BytesIO(data)
    f.name = f"recording.{sniff_ext(data)}"
    r = await OpenAISpeechToText(api_key=LLM_KEY).transcribe(file=f, model=STT_MODEL, response_format="json", language="en", temperature=0)
    return (getattr(r, "text", "") or "").strip()


async def _emergent_speak(text):
    return await asyncio.wait_for(OpenAITextToSpeech(api_key=LLM_KEY).generate_speech(text=text, model=TTS_MODEL, voice=TTS_VOICE), 30), "audio/mpeg"


async def _elevenlabs_transcribe(data):
    raise RuntimeError("ElevenLabs isn't set up yet (needs ELEVENLABS_API_KEY)")


async def _elevenlabs_speak(text):
    raise RuntimeError("ElevenLabs isn't set up yet (needs ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID)")


async def transcribe_bytes(data, mime=None):
    """Provider-switched speech to text; ElevenLabs errors fall back to Emergent for that turn."""
    if VOICE_PROVIDER == "elevenlabs":
        try:
            return await _elevenlabs_transcribe(data), "elevenlabs"
        except Exception as e:  # noqa: BLE001
            log.warning("elevenlabs stt failed, using emergent: %s", e)
    return await _emergent_transcribe(data), "emergent"


async def speak_text(text):
    """Provider-switched text to speech → (bytes, mime, provider)."""
    text = clean_for_tts(text)
    if VOICE_PROVIDER == "elevenlabs":
        try:
            b, m = await _elevenlabs_speak(text)
            return b, m, "elevenlabs"
        except Exception as e:  # noqa: BLE001
            log.warning("elevenlabs tts failed, using emergent: %s", e)
    b, m = await _emergent_speak(text)
    return b, m, "emergent"


def clean_for_tts(text):
    text = emoji.replace_emoji(text or "", replace="")
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"[*_#>~|✦]", "", text)
    return re.sub(r"\s+", " ", text).strip()[:4000]


def sniff_ext(data):
    if data[:4] == b"\x1a\x45\xdf\xa3":
        return "webm"
    if data[:4] == b"OggS":
        return "ogg"
    if data[:4] == b"RIFF":
        return "wav"
    if data[:3] == b"ID3" or (data[0] == 0xFF and data[1] & 0xE0 == 0xE0):
        return "mp3"
    return "m4a"


@router.post("/voice/transcribe")
async def transcribe(audio: UploadFile = File(...), user=Depends(get_user)):
    data = await audio.read()
    if len(data) < 2000:
        return {"text": "", "reason": "too_short"}
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(413, "That recording is too long. Please keep it under a few minutes")
    f = io.BytesIO(data)
    f.name = f"recording.{sniff_ext(data)}"  # browsers record webm, phones m4a — trust the bytes, not the name
    try:
        r = await OpenAISpeechToText(api_key=LLM_KEY).transcribe(file=f, model=STT_MODEL, response_format="json", language="en", temperature=0)
    except Exception as e:  # noqa: BLE001
        log.error("stt failed %s", e)
        raise HTTPException(422, "I couldn't hear that clearly. Please try again")
    return {"text": (getattr(r, "text", "") or "").strip()}


@router.get("/voice/tts/{message_id}.mp3")
async def speak(message_id: str, user=Depends(get_media_user)):
    m = await db.messages.find_one({"id": message_id}, NF)
    th = await db.threads.find_one({"id": (m or {}).get("thread_id")}, NF)
    u = user["id"]
    # same read rule as thread_access in server.py
    allowed = th and ((th["kind"] == "tenant" and th.get("tenant_id") == u) or (th["kind"] == "job" and th.get("handyman_id") == u)
                      or th.get("landlord_id") in (u, user.get("acting_by")))
    if not m or not allowed or m["role"] == "user":
        raise HTTPException(404, "Message not found")
    text = clean_for_tts(m["text"])
    if not text:
        raise HTTPException(404, "Nothing to read")
    key = hashlib.sha256(f"{text}|{TTS_VOICE}|1.0|{TTS_MODEL}|mp3".encode()).hexdigest()
    path = f"{APP_NAME}/tts/{key}.mp3"
    hit = await db.tts_cache.find_one({"key": key}, NF)
    if hit:
        data, _ = await asyncio.to_thread(get_object, hit["path"])
    else:
        try:
            data = await asyncio.wait_for(OpenAITextToSpeech(api_key=LLM_KEY).generate_speech(text=text, model=TTS_MODEL, voice=TTS_VOICE), 30)
        except Exception as e:  # noqa: BLE001
            log.error("tts failed %s", e)
            raise HTTPException(502, "Couldn't read this aloud. Tap to try again")
        res = await asyncio.to_thread(put_object, path, data, "audio/mpeg")
        await db.tts_cache.insert_one({"key": key, "path": res.get("path", path)})
    return Response(data, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=86400"})
