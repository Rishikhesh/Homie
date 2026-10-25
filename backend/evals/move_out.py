"""Move-out comparison evals with the REAL models (Jev screening + Sonnet review).

    cd /app/backend && python -m evals.move_out

Put your own pairs in evals/media/<pair_name>/ as move_in.jpg + move_out.jpg (png also fine) and an expected.json like
{"category": "damage", "charge": ">0", "box": true}  or  {"category": "none"}  (none = no item and no Sonnet call).
Optional "area" and "tickets" keys. Until you add some, generated test pairs are used.
"""
import asyncio, io, json, sys
from datetime import datetime
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import inspections as I

MEDIA = Path(__file__).parent / "media"


def _jpeg(im):
    b = io.BytesIO()
    im.convert("RGB").save(b, "JPEG", quality=88)
    return b.getvalue()


def _room(kind):
    im = Image.new("RGB", (1024, 768), (226, 220, 205))
    d = ImageDraw.Draw(im)
    if kind == "counter":
        d.rectangle([0, 430, 1024, 768], fill=(236, 236, 230))  # counter top
        d.rectangle([0, 420, 1024, 440], fill=(180, 180, 175))
        d.rectangle([120, 120, 420, 380], fill=(200, 215, 230), outline=(140, 140, 140), width=6)  # window
    elif kind == "wall":
        d.rectangle([0, 640, 1024, 768], fill=(150, 110, 75))  # floor
        d.rectangle([700, 200, 900, 640], fill=(245, 245, 240), outline=(120, 120, 120), width=6)  # door
    else:
        d.rectangle([0, 0, 1024, 768], fill=(60, 90, 60))
        for x in range(0, 1024, 90):
            d.rectangle([x, 300, x + 60, 768], fill=(110, 80, 50))  # a different scene: fence/garden
    return im


def generated():
    pairs = []
    a, b = _room("wall"), _room("wall")
    d = ImageDraw.Draw(b)
    for x, y in [(300, 260), (340, 250), (520, 300)]:
        d.ellipse([x, y, x + 6, y + 6], fill=(90, 90, 90))
    pairs.append(("nail_holes", a, b, {"category": "normal_wear", "charge": 0}, "Living room", []))
    a, b = _room("counter"), _room("counter")
    d = ImageDraw.Draw(b)
    d.ellipse([600, 520, 760, 640], fill=(45, 30, 18))
    d.ellipse([630, 545, 730, 615], fill=(20, 12, 8))
    pairs.append(("burn_on_counter", a, b.filter(ImageFilter.SMOOTH), {"category": "damage", "charge": ">0", "box": True}, "Kitchen", []))
    a, b = _room("wall"), _room("wall")
    for im in (a, b):
        ImageDraw.Draw(im).ellipse([200, 120, 380, 260], fill=(190, 160, 110))
    pairs.append(("stain_at_move_in", a, b, {"category": "pre_existing", "charge": 0}, "Bedroom", [], "large brown water stain on the wall near the ceiling"))
    a, b = _room("counter"), _room("counter")
    d = ImageDraw.Draw(b)
    d.line([300, 470, 520, 700], fill=(70, 70, 70), width=5)
    d.line([520, 700, 560, 760], fill=(70, 70, 70), width=4)
    pairs.append(("reported_crack", a, b, {"category": "reported_repair", "charge": 0}, "Kitchen",
                  [{"title": "Crack in kitchen counter", "date": "2026-04-02", "reported_by": "tenant", "status": "closed"}]))
    pairs.append(("different_angle", _room("counter"), _room("garden"), {"category": "check", "charge": 0}, "Kitchen", []))
    a = _room("counter")
    pairs.append(("no_change", a, a.copy(), {"category": "none"}, "Kitchen", []))
    return [{"name": p[0], "mi": _jpeg(p[1]), "mo": _jpeg(p[2]), "expected": p[3], "area": p[4], "tickets": p[5], "notes": p[6] if len(p) > 6 else ""} for p in pairs]


def from_media():
    out = []
    for d in sorted(x for x in MEDIA.glob("*") if x.is_dir()):
        mi = next(iter(sorted(d.glob("move_in.*"))), None)
        mo = next(iter(sorted(d.glob("move_out.*"))), None)
        if not (mi and mo and (d / "expected.json").exists()):
            continue
        exp = json.loads((d / "expected.json").read_text())
        out.append({"name": d.name, "mi": mi.read_bytes(), "mo": mo.read_bytes(), "expected": exp, "area": exp.get("area", d.name), "tickets": exp.get("tickets", []), "notes": exp.get("move_in_notes", "")})
    return out


def judge(exp, item, sonnet_called):
    if exp["category"] == "none":
        return item is None and not sonnet_called
    if not item or item["category"] != exp["category"]:
        return False
    if exp.get("charge") == ">0" and item["charge"] <= 0:
        return False
    if exp.get("charge") == 0 and item["charge"] != 0:
        return False
    return not exp.get("box") or bool(item["box"])


async def run_one(p):
    log = {"jev": None, "sonnet": False}

    async def jev(*a):
        log["jev"] = await I.jev_screen(*a)
        return log["jev"]

    async def son(*a):
        log["sonnet"] = True
        return await I.sonnet_review(*a)

    mi, ph1, s1 = I.prep_image(p["mi"])
    mo, ph2, s2 = I.prep_image(p["mo"])
    stats = {k: 0 for k in ("pairs_screened", "sent_to_sonnet", "jev_calls", "sonnet_calls", "jev_tokens", "sonnet_tokens")}
    ctx = {"tickets": p["tickets"], "state": {"name": "California", "deposit_limit": "1 month's rent"}, "past_repair_costs": ["Kitchen sink leak — Hank Miller $150"]}
    items, _ = await I.screen_pairs([{"area_key": p["area"].lower(), "area": p["area"], "notes": p["notes"], "dist": I.phash_dist(ph1, ph2), "mi": {"id": "mi", "jpeg": mi, "size": s1}, "mo": {"id": "mo", "jpeg": mo, "size": s2}}],
                                    jev, son, ctx, stats)
    item = items[0] if items else None
    return {"pair": p["name"], "expected": p["expected"], "jev": {k: v for k, v in (log["jev"] or {}).items() if k != "tokens"}, "to_sonnet": log["sonnet"],
            "category": item["category"] if item else "none", "charge": item["charge"] if item else 0, "box": bool(item and item["box"]),
            "explanation": item["explanation"] if item else "", "pass": judge(p["expected"], item, log["sonnet"])}


async def main():
    pairs = from_media() or generated()
    src = "evals/media" if from_media() else "generated test pairs"
    print(f"Move-out evals on {len(pairs)} pairs ({src})\n")
    rows = []
    for p in pairs:
        try:
            r = await run_one(p)
        except Exception as e:  # noqa: BLE001
            r = {"pair": p["name"], "expected": p["expected"], "jev": None, "to_sonnet": None, "category": f"error: {e}", "charge": 0, "box": False, "pass": False}
        rows.append(r)
        j = r["jev"] or {}
        print(f"{'PASS' if r['pass'] else 'FAIL'}  {r['pair']:<18} jev(same={j.get('same_view', '-'):<5} new={j.get('new_damage', '-'):<5} kind={j.get('kind', '-')}) "
              f"sonnet={'yes' if r['to_sonnet'] else 'no ':<3} -> {r['category']} ${r['charge']}{' +box' if r['box'] else ''}  (expected {r['expected']['category']})")
    sent = sum(1 for r in rows if r["to_sonnet"])
    print("-" * 100)
    print(f"Pairs screened: {len(rows)} · Sonnet calls made: {sent} · Sonnet calls saved: {len(rows) - sent} · Passed: {sum(r['pass'] for r in rows)}/{len(rows)}")
    out = Path(__file__).parent / "results"
    out.mkdir(exist_ok=True)
    (out / f"move_out-{datetime.now():%Y%m%d-%H%M%S}.json").write_text(json.dumps(rows, indent=2, default=str))
    return all(r["pass"] for r in rows)


if __name__ == "__main__":
    sys.exit(0 if asyncio.run(main()) else 1)
