import re
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
text = (ROOT / "12345" / "OKO26-1.mde").read_bytes().decode("latin-1", errors="ignore")
mde = sorted(set(re.findall(r"frm_(N\d{2}_[0-9A-Z]+|ND\d+)(?:[^0-9A-Z_]|$)", text, re.I)))
catalog = json.loads((ROOT / "portal/public/schemas/catalog.json").read_text(encoding="utf-8"))
portal = {f["id"] for f in catalog["forms"]}


def is_subform(f):
    last = f.split("_")[-1]
    return bool(re.match(r"^\d+[A-Z]$", last))


missing = [f for f in mde if f not in portal and not is_subform(f)]
extra = sorted(portal - set(mde))
subforms = [f for f in mde if f not in portal and is_subform(f)]

print("MDE real forms missing in portal (%d):" % len(missing))
for f in missing:
    print(" ", f)
print("\nPortal forms not in MDE (%d):" % len(extra))
for f in extra:
    print(" ", f)
print("\nMDE subforms/page variants (%d):" % len(subforms))
for f in subforms:
    print(" ", f)
