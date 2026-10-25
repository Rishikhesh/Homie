"""Handyman calls: Doorman rings a handyman in the app and agrees a time and price by voice.
On by choice only: the landlord turns on "Call handymen" in Settings and the handyman picks "Call me".
Any miss, decline or error falls back to the normal text offer right away — a call never blocks a repair."""
import asyncio, json, re
from datetime import timedelta
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from core import db, NF, uid, iso, now, get_user, get_media_user, need, first, post, tell_tenant, timeline, activity, strip_contacts, log, APP_NAME, put_object, get_object, DEMO

router = APIRouter(prefix="/api")
RING_S = 20 if DEMO else 45
MAX_CALL_S = 300
LIVE = ("ringing", "active")
VOICE_RULES = ("You are on a voice call with the handyman. Reply in 1-2 short spoken sentences. No lists or symbols. Say prices and times naturally. "
               "Before ending, repeat back the time options and the price and ask them to confirm. When they confirm, call accept_job. "
               "If they say they can't do it (busy, not this week, too far), call decline_job right away — don't suggest other dates; Doorman will ask someone else. "
               "If they want to think about it, say they can tap Accept in the app later and call end_call. You never approve money: a price only goes to the owner for OK. "
               "Never share the tenant's phone, email or the address before booking.")


async def wants_call(ticket, h):
    """The handyman's own choice decides: 'Call me' on their Profile."""
    return h.get("contact_pref") == "call"


async def move(call_id, expected, new, extra=None):
    exp = [expected] if isinstance(expected, str) else list(expected)
    c = await db.calls.find_one_and_update({"id": call_id, "status": {"$in": exp}}, {"$set": {"status": new, **(extra or {})}}, projection=NF, return_document=True)
    if not c:
        raise HTTPException(409, "This call has already ended")
    return c


async def start_call(ticket, h, jt):
    """Ring the handyman. The text offer waits until the call misses, is declined or fails."""
    if await db.calls.find_one({"ticket_id": ticket["id"], "status": {"$in": list(LIVE)}}):
        return None
    c = {"id": uid(), "ticket_id": ticket["id"], "landlord_id": ticket["landlord_id"], "handyman_id": h["user_id"], "thread_id": jt["id"], "status": "ringing",
         "outcome": None, "turns": [], "ring_started_at": iso(), "answered_at": None, "ended_at": None, "duration_s": 0, "summary": None}
    await db.calls.insert_one(dict(c))
    await db.tickets.update_one({"id": ticket["id"]}, {"$set": {"call_id": c["id"]}})
    return c


async def fall_back(c, status):
    """Missed / declined on the ring screen / failed → text offer now."""
    from flows import post_offer, handyman_doc, get_ticket
    c = await move(c["id"], "ringing", status, {"ended_at": iso(), "outcome": "declined" if status == "declined" else "no_answer"})
    t = await get_ticket(c["ticket_id"])
    if t["status"] != "offered" or t.get("handyman_id") != c["handyman_id"]:
        return c
    h = await handyman_doc(c["handyman_id"])
    await db.tickets.update_one({"id": t["id"]}, {"$set": {"missed_call": True}})
    await post_offer(t, h, c["thread_id"], prefix="Tried calling you — here are the job details. ")
    word = "couldn't talk" if status == "declined" else "no answer"
    await timeline(t["id"], f"Called {first(h['name'])} — {word} · Texted the job offer", actor="agent")
    await activity(t["landlord_id"], f"Called {first(h['name'])} — {word}, texted the offer", t["id"])
    await tell_tenant(t, f"{first(h['name'])} didn't pick up, so I've messaged him too.")
    return c


async def end_call(c, outcome, reason=""):
    """Active → ended; summary, a line in the job chat and the timeline; undecided leaves the text offer open."""
    from agent import quick
    from flows import post_offer, handyman_doc, get_ticket
    started = c.get("answered_at") or c["ring_started_at"]
    from datetime import datetime
    dur = int((now() - datetime.fromisoformat(started)).total_seconds())
    c = await move(c["id"], "active", "ended", {"ended_at": iso(), "outcome": outcome, "duration_s": dur})
    talk = "\n".join(f"{x['who']}: {x['text']}" for x in c["turns"])
    summary = strip_contacts(await quick("Summarize this phone call between Doorman and a handyman in one short line (max 12 words). Output only the line.", talk or "No talk.") or outcome)
    await db.calls.update_one({"id": c["id"]}, {"$set": {"summary": summary}})
    h = await handyman_doc(c["handyman_id"])
    mmss = f"{dur // 60}:{dur % 60:02d}"
    word = {"accepted": "accepted", "declined": "can't do it", "undecided": "thinking about it"}.get(outcome, outcome)
    await post(c["thread_id"], f"Call with Doorman · {mmss} · {summary}", cards=[{"type": "call", "call_id": c["id"]}])
    await timeline(c["ticket_id"], f"Called {first(h['name'])} · {mmss} · {word}", actor="agent")
    await db.tickets.update_one({"id": c["ticket_id"], "timeline.text": f"Called {first(h['name'])} · {mmss} · {word}"}, {"$set": {"timeline.$.call_id": c["id"]}})
    t = await get_ticket(c["ticket_id"])
    if outcome == "undecided" and t["status"] == "offered" and t.get("handyman_id") == c["handyman_id"]:
        await post_offer(t, h, c["thread_id"], prefix="Thanks for the chat — tap Accept when you've decided. ")
    return {**c, "summary": summary}


async def tick_calls():
    """Ring timeout → missed; 5-minute cap on active calls."""
    async for c in db.calls.find({"status": "ringing", "ring_started_at": {"$lt": iso(now() - timedelta(seconds=RING_S))}}, NF):
        try:
            await fall_back(c, "missed")
        except HTTPException:
            pass
    async for c in db.calls.find({"status": "active", "answered_at": {"$lt": iso(now() - timedelta(seconds=MAX_CALL_S))}}, NF):
        try:
            await end_call(c, "undecided")
        except HTTPException:
            pass


async def _mine(call_id, user):
    need(user, "handyman")
    c = await db.calls.find_one({"id": call_id}, NF)
    if not c:
        raise HTTPException(404, "Call not found")
    if c["handyman_id"] != user["id"]:
        raise HTTPException(403, "This call isn't for you")
    return c


async def _say(c, text, extra=None):
    """Agent turn: save, speak (best effort) and return the API shape."""
    from voice import speak_text
    text = strip_contacts(text)
    turn = {"who": "agent", "text": text, "at": iso(), "audio_file_id": None, "provider": None, "ms": extra or {}}
    t0 = now()
    try:
        data, mime, prov = await speak_text(text)
        path = f"{APP_NAME}/calls/{c['id']}/{uid()}.mp3"
        res = await asyncio.to_thread(put_object, path, data, mime)
        turn.update(audio_file_id=res.get("path", path), provider=prov)
    except Exception as e:  # noqa: BLE001 — still show the text
        log.error("call tts failed %s", e)
    turn["ms"]["tts"] = int((now() - t0).total_seconds() * 1000)
    c = await db.calls.find_one_and_update({"id": c["id"]}, {"$push": {"turns": turn}}, projection=NF, return_document=True)
    i = len(c["turns"]) - 1
    return {"text": text, "audio_url": f"/calls/{c['id']}/turns/{i}.mp3" if turn["audio_file_id"] else None, "turn": i}


async def opening_line(c):
    from flows import ctx, handyman_doc, get_ticket
    t = await get_ticket(c["ticket_id"])
    prop, unit, _, _ = await ctx(t)
    h = await handyman_doc(c["handyman_id"])
    return (f"Hi {first(h['name'])}, it's Doorman for {prop['address'].split(',')[0]} in {prop['city']}. {t['title']} in {unit['label']}. "
            f"Can you take it this week, and roughly what would it cost?")


# ---------- the call agent: same job-seat brief + voice rules + accept / decline / end tools ----------
def _tools():
    from agent import fn, S
    return [fn("accept_job", "The handyman confirmed a price and 1-3 visit times. Sends the price to the owner for OK and the times to the tenant.",
               {"quote": {"type": "number"}, "slots": {"type": "array", "items": S, "description": "1-3 local times, ISO like 2026-10-30T15:00"}}, ["quote", "slots"]),
            fn("decline_job", "The handyman can't take the job.", {"reason": S}, []),
            fn("end_call", "End the call without a decision (they'll decide later).", {}, [])]


async def agent_turn(c, said, user):
    from agent import llm, SONNET, build_system
    from flows import ctx, get_ticket, handyman_accept, handyman_decline
    t = await get_ticket(c["ticket_id"])
    prop, _, _, _ = await ctx(t)
    thread = await db.threads.find_one({"id": c["thread_id"]}, NF)
    system = await build_system(thread, user) + f"\n\nVOICE CALL:\n{VOICE_RULES}\nToday is {now().astimezone().strftime('%A %Y-%m-%d')}. Property time zone: {prop['timezone']}."
    history = "\n".join(f"{'Doorman' if x['who'] == 'agent' else 'Handyman'}: {x['text']}" for x in c["turns"])
    chat = llm(system, SONNET, f"call-{c['id']}-{uid()}").with_tools(_tools())
    from emergentintegrations.llm.chat import UserMessage
    resp = await chat.send_message_with_tools(UserMessage(text=f"Call so far:\n{history}\n\nHandyman just said: {said}"))
    outcome = None
    for _ in range(3):
        if not resp.tool_calls:
            break
        for tc in resp.tool_calls:
            a = tc.arguments or {}
            out = {"ok": True}
            try:
                if tc.name == "accept_job" and t["status"] == "offered":
                    await handyman_accept(t, c["handyman_id"], float(a["quote"]), a.get("slots") or [])
                    outcome = "accepted"
                elif tc.name == "decline_job" and t["status"] == "offered":
                    await handyman_decline(t, c["handyman_id"], "declined")
                    outcome = "declined"
                elif tc.name == "end_call":
                    outcome = outcome or "undecided"
            except Exception as e:  # noqa: BLE001
                out = {"error": getattr(e, "detail", str(e))}
            chat.add_tool_result(tc.id, json.dumps(out))
        resp = await chat.send_message_with_tools(None)
    reply = (resp.content or "").strip() or ("Great, I've sent that to the owner. Thanks!" if outcome == "accepted" else "Thanks for letting me know." if outcome == "declined" else "Okay, talk soon.")
    reply = re.sub(r"[*#•\-]{1,}\s", "", reply)
    return two_sentences(reply), outcome


def two_sentences(text):
    """Spoken replies: at most 2 sentences; a question is never dropped."""
    s = [x for x in re.split(r"(?<=[.!?])\s+", text.strip()) if x]
    if len(s) <= 2:
        return text.strip()
    q = next((x for x in reversed(s) if x.endswith("?")), None)
    keep = s[:2] if not q or q in s[:2] else [s[0], q]
    return " ".join(keep)


# ---------- endpoints ----------
@router.get("/calls/incoming")
async def incoming(user=Depends(get_user)):
    need(user, "handyman")
    c = await db.calls.find_one({"handyman_id": user["id"], "status": "ringing"}, NF, sort=[("ring_started_at", -1)])
    if not c:
        return {"call": None}
    t = await db.tickets.find_one({"id": c["ticket_id"]}, NF)
    prop = await db.properties.find_one({"id": t["property_id"]}, NF)
    return {"call": {"id": c["id"], "title": t["title"], "city": prop["city"], "trade": t["trade"], "ring_started_at": c["ring_started_at"], "ring_s": RING_S}}


@router.get("/calls/{call_id}")
async def get_call(call_id: str, user=Depends(get_user)):
    c = await db.calls.find_one({"id": call_id}, NF)
    if not c or not ({user["id"], user.get("acting_by")} & {c["handyman_id"], c["landlord_id"]}):
        raise HTTPException(404, "Call not found")
    t = await db.tickets.find_one({"id": c["ticket_id"]}, NF)
    h = await db.handymen.find_one({"user_id": c["handyman_id"]}, NF)
    turns = [{**{k: v for k, v in x.items() if k != "audio_file_id"}, "audio_url": f"/calls/{c['id']}/turns/{i}.mp3" if x.get("audio_file_id") else None} for i, x in enumerate(c["turns"])]
    return {**{k: v for k, v in c.items() if k != "turns"}, "turns": turns, "title": t["title"], "handyman_name": h["name"] if h else ""}


@router.get("/calls/{call_id}/turns/{i}.mp3")
async def turn_audio(call_id: str, i: int, user=Depends(get_media_user)):
    c = await db.calls.find_one({"id": call_id}, NF)
    if not c or not ({user["id"], user.get("acting_by")} & {c["handyman_id"], c["landlord_id"]}) or i >= len(c["turns"]) or not c["turns"][i].get("audio_file_id"):
        raise HTTPException(404, "Not found")
    data, _ = await asyncio.to_thread(get_object, c["turns"][i]["audio_file_id"])
    return Response(data, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=86400"})


@router.post("/calls/{call_id}/answer")
async def answer(call_id: str, user=Depends(get_user)):
    c = await _mine(call_id, user)
    c = await move(c["id"], "ringing", "active", {"answered_at": iso()})
    await timeline(c["ticket_id"], f"{first(user['name'])} answered the call")
    return {"status": "active", **(await _say(c, await opening_line(c)))}


@router.post("/calls/{call_id}/decline")
async def decline(call_id: str, user=Depends(get_user)):
    c = await _mine(call_id, user)
    await fall_back(c, "declined")
    return {"status": "declined"}


@router.post("/calls/{call_id}/turn")
async def turn(call_id: str, audio: UploadFile | None = File(None), text: str | None = Form(None), user=Depends(get_user)):
    from voice import transcribe_bytes
    c = await _mine(call_id, user)
    if c["status"] != "active":
        raise HTTPException(409, "This call has already ended")
    t0 = now()
    said, prov = (text or "").strip(), "typed"
    if not said and audio is not None:
        data = await audio.read()
        if len(data) >= 2000:
            try:
                said, prov = await transcribe_bytes(data)
            except Exception as e:  # noqa: BLE001
                log.error("call stt failed %s", e)
    stt_ms = int((now() - t0).total_seconds() * 1000)
    if not said:
        return {**(await _say(c, "Sorry, I didn't catch that. Could you say it again?", {"stt": stt_ms})), "ended": False, "heard": ""}
    said = strip_contacts(said)
    c = await db.calls.find_one_and_update({"id": c["id"]}, {"$push": {"turns": {"who": "handyman", "text": said, "at": iso(), "audio_file_id": None, "provider": prov, "ms": {"stt": stt_ms}}}},
                                           projection=NF, return_document=True)
    await post(c["thread_id"], f"📞 {said}", role="user", sender_id=user["id"])
    t1 = now()
    try:
        reply, outcome = await agent_turn(c, said, user)
    except Exception as e:  # noqa: BLE001 — keep the call open
        log.error("call agent failed %s", e)
        reply, outcome = "Sorry, I'm having trouble. You can also tap Accept in the app.", None
    agent_ms = int((now() - t1).total_seconds() * 1000)
    out = await _say(c, reply, {"agent": agent_ms})
    await post(c["thread_id"], f"📞 {strip_contacts(reply)}")
    ended = outcome in ("accepted", "declined", "undecided")
    if ended:
        c = await db.calls.find_one({"id": c["id"]}, NF)
        await end_call(c, outcome)
    return {**out, "ended": ended, "outcome": outcome, "heard": said}


@router.post("/calls/{call_id}/say")
async def say_typed(call_id: str, body: dict, user=Depends(get_user)):
    """'Type instead' on the call screen."""
    return await turn(call_id, None, str(body.get("text") or "")[:1000], user)


@router.post("/calls/{call_id}/hangup")
async def hangup(call_id: str, user=Depends(get_user)):
    c = await _mine(call_id, user)
    if c["status"] == "ringing":
        await fall_back(c, "declined")
        return {"status": "declined"}
    c = await end_call(c, c.get("outcome") or "undecided")
    return {"status": "ended", "summary": c["summary"], "duration_s": c["duration_s"]}
