"""Visual-language eval (real model): 20 tenant messages.
  ≥90% of agent text lines ≤12 words · every repair-related reply has a repair card · every yes/no question uses a yes_no card.
    cd /app/backend && python -m evals.visual
"""
import json, re, sys, time
from datetime import datetime
from pathlib import Path
from . import harness as h

MSGS = [
    "My dryer stopped working", "It won't spin at all, the drum is stuck", "When is my rent due?", "How much is my rent?",
    "The kitchen faucet is dripping", "Can I have a cat?", "What's the wifi password situation, who sets up internet?",
    "Is Hank coming to fix the dryer?", "The bathroom light flickers", "How many days does my landlord have to return my deposit?",
    "Thanks!", "My smoke alarm keeps beeping", "Can I paint my bedroom?", "What's happening with my repairs?",
    "When does my lease end?", "The front door lock is sticky", "Do I need renters insurance?", "Can someone come tomorrow morning?",
    "The heater makes a loud noise", "What do I do if I'm locked out?",
]
YN = re.compile(r"^(is|are|do|does|did|can|could|should|would|will|have|has|was|were)\b[^?]*\?$", re.I)
REPAIR_TOOLS = {"create_ticket", "update_ticket", "message_handyman", "book_time", "start_self_fix", "confirm_fixed"}


def main():
    h.reset()
    tid = h.thread_id("tenant")
    rows = []
    for i, text in enumerate(MSGS):
        t0 = time.time()
        _, sent = h.say("tenant", tid, text)
        msgs = list(h.db.messages.find({"thread_id": tid, "created_at": {"$gt": sent}, "role": "assistant"}, h.NF).sort("created_at", 1))
        used = set(h.tools(tid, sent))
        for m in msgs[-1:]:
            words = len(m["text"].split())
            cards = {c.get("type") for c in m.get("cards") or []}
            repair = bool(used & REPAIR_TOOLS)
            q = m["text"].strip().split(". ")[-1]
            yn = bool(YN.match(q.strip())) and " or " not in q.lower()
            rows.append({"n": i + 1, "msg": text, "reply": m["text"], "words": words, "short": words <= 12, "repair": repair,
                         "repair_card": (not repair) or bool(cards & {"repair", "choice_time", "yes_no"}), "yes_no_q": yn, "yes_no_card": (not yn) or "yes_no" in cards,
                         "cards": sorted(c for c in cards if c), "s": round(time.time() - t0, 1)})
            r = rows[-1]
            print(f"#{r['n']:<2} {r['words']:>2}w {'✓' if r['short'] else '✗'}  repair:{'✓' if r['repair_card'] else '✗'}{'*' if repair else ' '} yn:{'✓' if r['yes_no_card'] else '✗'}{'*' if yn else ' '}  {','.join(r['cards']):<22} {r['reply'][:70]}", flush=True)
    short = sum(r["short"] for r in rows) / max(1, len(rows))
    rep = [r for r in rows if r["repair"]]
    yn = [r for r in rows if r["yes_no_q"]]
    res = {"short_pct": round(short * 100), "short_pass": short >= 0.9,
           "repair": f"{sum(r['repair_card'] for r in rep)}/{len(rep)}", "repair_pass": all(r["repair_card"] for r in rep),
           "yes_no": f"{sum(r['yes_no_card'] for r in yn)}/{len(yn)}", "yes_no_pass": all(r["yes_no_card"] for r in yn)}
    print("-" * 90)
    print(f"| Check                         | Result | Pass |\n|---|---|---|\n| Text lines ≤ 12 words (≥90%)  | {res['short_pct']}% | {'PASS' if res['short_pass'] else 'FAIL'} |"
          f"\n| Repair replies with repair card | {res['repair']} | {'PASS' if res['repair_pass'] else 'FAIL'} |\n| Yes/no questions as yes_no card | {res['yes_no']} | {'PASS' if res['yes_no_pass'] else 'FAIL'} |")
    out = Path(__file__).parent / "results" / f"visual-{datetime.now():%Y%m%d-%H%M%S}.json"
    out.write_text(json.dumps({"summary": res, "rows": rows}, indent=2))
    print(f"Saved {out}")
    h.reset()
    sys.exit(0 if res["short_pass"] and res["repair_pass"] and res["yes_no_pass"] else 1)


if __name__ == "__main__":
    main()
