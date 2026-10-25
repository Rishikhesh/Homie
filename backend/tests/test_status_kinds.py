"""Test 4: every status of every entity maps to exactly one of the 4 kinds; 'needs the viewer's action' is always 'you'.
The fixture is shared with the app (frontend/src/status.fixture.json) and checked there on the Visual QA screen."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
FIX = json.loads((Path(__file__).resolve().parents[2] / "frontend/src/status.fixture.json").read_text())
KINDS = {"good", "waiting", "you", "none"}


def test_every_ticket_status_is_covered():
    import os
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "test")
    src = (Path(__file__).resolve().parents[1] / "server.py").read_text()
    step_line = next(l for l in src.splitlines() if l.startswith("STEP = "))
    cont = src.split(step_line, 1)[1].split("\n", 1)[0]
    statuses = set(__import__("re").findall(r'"(\w+)":', step_line + cont))
    assert statuses, "could not read STEP"
    missing = statuses - set(FIX["ticket"])
    assert not missing, f"statuses with no kind: {missing}"
    for s, roles in FIX["ticket"].items():
        assert set(roles) == {"tenant", "landlord", "handyman"}, s


def test_every_mapping_is_one_of_four_kinds():
    for typ in ("ticket", "rent", "lease", "moveout", "approval"):
        for s, roles in FIX[typ].items():
            for role, kind in roles.items():
                assert kind in KINDS, f"{typ}.{s}.{role} -> {kind}"


def test_viewer_action_is_always_you():
    for typ, m in FIX["needs_viewer_action"].items():
        for s, roles in m.items():
            for role in roles:
                assert FIX[typ][s][role] == "you", f"{typ}.{s} needs {role} but maps to {FIX[typ][s][role]}"
    # and nothing else is red
    for typ, table in FIX.items():
        if typ.startswith("_") or typ == "needs_viewer_action":
            continue
        for s, roles in table.items():
            for role, kind in roles.items():
                if kind == "you":
                    assert role in FIX["needs_viewer_action"].get(typ, {}).get(s, []), f"{typ}.{s}.{role} is red without needing action"
