import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
catalog = json.loads((ROOT / "portal/public/schemas/catalog.json").read_text(encoding="utf-8"))

empty = []
for f in catalog["forms"]:
    fid = f["id"]
    s = json.loads((ROOT / f"portal/public/schemas/{fid}.json").read_text(encoding="utf-8"))
    rows = s.get("rows", [])
    cols = [c for c in s.get("columns", []) if c.get("type") == "number"]
    if not rows:
        empty.append(fid)
    elif len(cols) <= 2 and fid not in ("N03_2", "N01_34"):
        pass

print("Empty rows:", empty)
print("Count:", len(empty))
