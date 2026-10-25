# Test helper: start a ringing call to Hank for his latest offered ticket (usage: python ring_now.py [delay_s])
import asyncio, os, sys, time
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, timezone
import uuid

HANK = "4153c8fd2e9d439f"


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    t = await db.tickets.find_one({"handyman_id": HANK, "status": "offered"}, {"_id": 0}, sort=[("created_at", -1)])
    assert t, "no offered ticket for Hank"
    await db.calls.update_many({"ticket_id": t["id"], "status": {"$in": ["ringing", "active"]}}, {"$set": {"status": "missed"}})
    c = {"id": uuid.uuid4().hex[:16], "ticket_id": t["id"], "landlord_id": t["landlord_id"], "handyman_id": HANK, "thread_id": t["job_thread_id"], "status": "ringing",
         "outcome": None, "turns": [], "ring_started_at": datetime.now(timezone.utc).isoformat(), "answered_at": None, "ended_at": None, "duration_s": 0, "summary": None}
    await db.calls.insert_one(dict(c))
    await db.tickets.update_one({"id": t["id"]}, {"$set": {"call_id": c["id"]}})
    print(c["id"], t["id"])

if len(sys.argv) > 1:
    time.sleep(float(sys.argv[1]))
asyncio.run(main())
