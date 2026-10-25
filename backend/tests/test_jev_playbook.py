# Playbook check: the app's Jev route (inspections.JEV_QS) returns real typed answers (not a fallback)
import io, os, sys, base64
import httpx, pytest
from dotenv import load_dotenv
from PIL import Image, ImageDraw

sys.path.insert(0, "/app/backend")
load_dotenv("/app/backend/.env")
import inspections as ins  # noqa: E402


def _img(dmg=False):
    im = Image.new("RGB", (800, 600), (225, 220, 210))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 450, 800, 600], fill=(140, 100, 60))  # floor
    d.rectangle([300, 150, 500, 450], fill=(250, 250, 250), outline=(80, 80, 80), width=6)  # door
    if dmg:
        d.ellipse([120, 200, 220, 290], fill=(30, 30, 30))  # hole in wall
    b = io.BytesIO(); im.save(b, "JPEG", quality=85); return b.getvalue()


def test_jev_raw_answers_shape():
    proxy = (os.environ.get("INTEGRATION_PROXY_URL") or "https://integrations.emergentagent.com").rstrip("/")
    body = {"model": "jev-latest", "questions": ins.JEV_QS, "state": {"move_in": ins._data_url(_img()), "move_out": ins._data_url(_img(True)),
            "area": "Living room", "move_in_notes": "", "unit_tickets": []}}
    r = httpx.post(f"{proxy}/llm/typesafe/v1/systemone", json=body, timeout=60,
                   headers={"Authorization": f"Bearer {ins.LLM_KEY}", "TypeSafe-Danger-Zone-Images": "true"})
    if r.status_code == 429:
        pytest.skip("Jev CAPACITY_LIMIT (transient)")
    assert r.status_code == 200, r.text[:300]
    a = r.json()["answers"]
    print(a)
    for k in ("same_view", "new_damage"):
        assert 0 <= a[k]["noul"] <= 1
    assert a["kind"]["choice"] in ins.JEV_QS["kind"]["criteria"]
    probs = a["severity"]["probabilities"]
    assert probs and all(0 <= int(x) < len(ins.JEV_QS["severity"]["criteria"]) for x in probs)
    assert abs(sum(probs.values()) - 1) < 0.05
