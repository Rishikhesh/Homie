"""Run the Rentwise agent evals against the running backend (DEMO_MODE=1) with the real models.

    cd /app/backend && python -m evals.run            # all cases + tone eval
    python -m evals.run --only 0,7,14                  # pick cases by number
    python -m evals.run --no-tone                      # skip the Haiku tone judge

Prints a pass/fail table and saves evals/results/<timestamp>.json. Resets the sample home between cases.
"""
import argparse, asyncio, json, re, sys, time, traceback
from datetime import datetime
from pathlib import Path
from . import harness
from .cases import CASES

TONE_SYS = ("You grade replies from a landlord's AI assistant to tenants, handymen and landlords. For the reply, score 1-5 on each of: warm, clear, short, "
            "next_step (does it tell the reader what happens next or what to do). Return ONLY JSON like {\"warm\":4,\"clear\":5,\"short\":4,\"next_step\":3}.")


def num(fn):
    return int(re.match(r"case_(\d+)", fn.__name__).group(1))


async def tone(replies):
    import agent
    from core import HAIKU
    scores = []
    for r in replies[:30]:
        raw = await agent.quick(TONE_SYS, r, model=HAIKU)
        m = re.search(r"\{.*\}", raw or "", re.S)
        try:
            s = json.loads(m.group(0))
            scores.append(sum(float(s[k]) for k in ("warm", "clear", "short", "next_step")) / 4)
        except Exception:  # noqa: BLE001
            continue
    return round(sum(scores) / len(scores), 2) if scores else None, len(scores)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated case numbers")
    ap.add_argument("--no-tone", action="store_true")
    args = ap.parse_args()
    only = {int(x) for x in args.only.split(",")} if args.only else None
    rows = []
    for fn in CASES:
        n = num(fn)
        if only is not None and n not in only:
            continue
        t0 = time.time()
        try:
            note, ok = fn(), True
        except harness.EvalFail as e:
            note, ok = str(e), False
        except Exception as e:  # noqa: BLE001
            note, ok = f"error: {e}", False
            traceback.print_exc()
        rows.append({"case": n, "name": fn.__name__[len(f"case_{n}_"):], "pass": ok, "note": note, "seconds": round(time.time() - t0, 1)})
        print(f"{'PASS' if ok else 'FAIL'}  #{n:<2} {rows[-1]['name']:<32} {rows[-1]['seconds']:>6}s  {note}", flush=True)
    tone_avg, tone_n = (None, 0) if args.no_tone or not harness.REPLIES else asyncio.run(tone(harness.REPLIES))
    passed = sum(r["pass"] for r in rows)
    print("-" * 90)
    print(f"Scenarios: {passed}/{len(rows)} passed")
    if tone_avg is not None:
        print(f"Tone: {tone_avg} average over {tone_n} replies ({'PASS' if tone_avg >= 4 else 'FAIL'}, needs >= 4)")
    out = Path(__file__).parent / "results"
    out.mkdir(exist_ok=True)
    f = out / f"{datetime.now():%Y%m%d-%H%M%S}.json"
    f.write_text(json.dumps({"at": datetime.now().isoformat(), "scenarios": rows, "passed": passed, "total": len(rows),
                             "tone": {"average": tone_avg, "replies": tone_n, "pass": tone_avg is not None and tone_avg >= 4}}, indent=2))
    print(f"Saved {f}")
    # leave the demo account clean
    harness.reset()
    sys.exit(0 if passed == len(rows) and (tone_avg is None or tone_avg >= 4) else 1)


if __name__ == "__main__":
    main()
