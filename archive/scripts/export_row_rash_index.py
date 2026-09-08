#!/usr/bin/env python3
"""Export per-row / per-column sp_rash kod from z261.mdb a_stblROWs → row-rash-index.json."""
from __future__ import annotations

import csv
import io
import json
import os
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MDB = Path(os.environ.get("OKO_MDB_PATH", "")).resolve() if os.environ.get("OKO_MDB_PATH") else None
if not MDB or not MDB.exists():
    MDB = ROOT / "reference" / "z261.mdb"
if not MDB.exists():
    MDB = ROOT / "12345" / "z261.m_b"
OUT = ROOT / "portal" / "public" / "data" / "row-rash-index.json"
CATALOG = ROOT / "portal" / "public" / "schemas" / "catalog.json"

LETTER_COLS = list("BCDEFGHIJKLMNOPQRSTUVWXYZ") + [
    "Б",
    "Г",
    "Д",
    "Ж",
    "З",
    "И",
    "Л",
    "П",
    "Ф",
    "Ц",
    "Ч",
    "Ш",
    "Щ",
    "Э",
    "Ю",
    "Я",
]


def mdb_export(table: str) -> str:
    return subprocess.check_output(
        ["mdb-export", str(MDB), table], text=True, errors="replace"
    )


def is_rash_kod(v: str | None) -> bool:
    if v is None:
        return False
    s = str(v).strip()
    return s.isdigit() and int(s) > 100


def load_schema_form_ids() -> list[str]:
    if not CATALOG.exists():
        return []
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    return [f["id"] for f in data.get("forms", [])]


def form_id_from_rname(name: str, schema_forms: list[str]) -> str:
    for fid in sorted(schema_forms, key=len, reverse=True):
        if name == fid or name.startswith(f"{fid}_"):
            return fid
    return name


def pick_subform_kod(form: str, rules: list[dict]) -> int | None:
    for rule in rules:
        nm = rule.get("rName") or ""
        if nm.startswith(f"{form}_") and nm.endswith("_2"):
            kod = int(rule["kod"])
            if kod > 100:
                return kod
    for rule in rules:
        nm = rule.get("rName") or ""
        if nm == form or nm.startswith(f"{form}_"):
            kod = int(rule["kod"])
            if kod > 100 and (rule.get("rItogo") or rule.get("totalFormula")):
                return kod
    return None


def main() -> int:
    if not MDB.exists():
        print(f"MDB not found: {MDB}", file=sys.stderr)
        return 1

    schema_forms = load_schema_form_ids()
    rash_raw = mdb_export("sp_rash")
    rules = list(csv.DictReader(io.StringIO(rash_raw)))

    rows_raw = mdb_export("a_stblROWs")
    forms: dict[str, dict[str, dict]] = {}

    for row in csv.DictReader(io.StringIO(rows_raw)):
        form = row["TName"]
        if not form.startswith("N"):
            continue
        row_no = str(int(row["RowNo"]))
        col_kods: dict[str, int] = {}
        for col in LETTER_COLS:
            if is_rash_kod(row.get(col)):
                col_kods[col] = int(str(row[col]).strip())

        default: int | None = None
        if col_kods:
            default = Counter(col_kods.values()).most_common(1)[0][0]
        else:
            indent = len(row["RowName"]) - len(row["RowName"].lstrip())
            if indent > 0 and row.get("B") == "2":
                default = pick_subform_kod(form, rules)

        if not default and not col_kods:
            continue

        entry: dict = {}
        if default:
            entry["defaultKod"] = default
        if col_kods:
            entry["columns"] = col_kods
        forms.setdefault(form, {})[row_no] = entry

    for rule in rules:
        ref = (rule.get("ref_rows") or "").strip()
        if not ref:
            continue
        rname = rule.get("rName") or ""
        form = form_id_from_rname(rname, schema_forms)
        kod = int(rule["kod"])
        if kod <= 100:
            continue
        for token in ref.split(","):
            rn = token.strip()
            if not rn:
                continue
            bucket = forms.setdefault(form, {})
            if rn in bucket:
                continue
            bucket[rn] = {"defaultKod": kod}

    payload = {
        "version": "1.0",
        "source": MDB.name,
        "forms": forms,
        "stats": {
            "forms": len(forms),
            "rows": sum(len(v) for v in forms.values()),
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT} ({payload['stats']['rows']} rows, {payload['stats']['forms']} forms)")

    schemas_dir = ROOT / "portal" / "public" / "schemas"
    patched = 0
    for fpath in sorted(schemas_dir.glob("*.json")):
        if fpath.name == "catalog.json":
            continue
        form_id = fpath.stem
        form_index = forms.get(form_id, {})
        if not form_index:
            continue
        data = json.loads(fpath.read_text(encoding="utf-8"))
        changed = False
        for row in data.get("rows", []):
            num_raw = row.get("num")
            if num_raw is None or num_raw == "":
                continue
            num = str(int(num_raw))
            meta = form_index.get(num)
            if not meta or meta.get("defaultKod") is None:
                continue
            kod = meta["defaultKod"]
            if row.get("rashKod") != kod:
                row["rashKod"] = kod
                changed = True
        if changed:
            fpath.write_text(
                json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            patched += 1
    if patched:
        print(f"Patched rashKod in {patched} schema files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
