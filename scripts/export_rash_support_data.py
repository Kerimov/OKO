#!/usr/bin/env python3
"""Export sp_kontr and refs (classifiers) from z261.mdb → portal/public/data/."""
from __future__ import annotations

import csv
import io
import json
import os
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MDB = Path(os.environ.get("OKO_MDB_PATH", "")).resolve() if os.environ.get("OKO_MDB_PATH") else None
if not MDB or not MDB.exists():
    MDB = ROOT / "reference" / "z261.mdb"
if not MDB.exists():
    MDB = ROOT / "12345" / "z261.m_b"
OUT = ROOT / "portal" / "public" / "data"

FL_AGENT = {
    "id": 3041,
    "name": "ФИЗИЧЕСКИЕ ЛИЦА",
    "orgForm": None,
    "orgType": 3,
    "inn": "0000000000",
    "kpp": "000000003",
    "country": "STL",
}


def mdb_export(table: str) -> str:
    return subprocess.check_output(
        ["mdb-export", str(MDB), table], text=True, errors="replace"
    )


def parse_int(v: str | None) -> int | None:
    if v is None or str(v).strip() == "":
        return None
    try:
        return int(float(v))
    except ValueError:
        return None


def export_kontr() -> dict:
    raw = mdb_export("sp_kontr")
    items = []
    seen_ids: set[int] = set()
    for row in csv.DictReader(io.StringIO(raw)):
        kid = parse_int(row.get("id"))
        if kid is None:
            continue
        seen_ids.add(kid)
        org_type = parse_int(row.get("orgType"))
        items.append(
            {
                "id": kid,
                "name": (row.get("RowName") or "").strip(),
                "orgForm": row.get("OrgForm") or None,
                "orgType": org_type,
                "inn": row.get("inn") or None,
                "kpp": row.get("kpp") or None,
                "country": row.get("Country") or None,
                "city": row.get("City") or None,
                "ogrn": row.get("ogrn") or None,
                "use": parse_int(row.get("Use")) == 1,
                "mandatoryRash": (row.get("Forms") or "").strip() == "обяз.расшифровка",
            }
        )
    if FL_AGENT["id"] not in seen_ids:
        items.append(FL_AGENT)
    items.sort(key=lambda x: (x["name"] or "").lower())
    return {
        "version": "1.2",
        "source": MDB.name,
        "total": len(items),
        "items": items,
    }


def export_refs() -> dict:
    raw = mdb_export("refs")
    by_name: dict[str, list[dict]] = defaultdict(list)
    for row in csv.DictReader(io.StringIO(raw)):
        name = (row.get("ref_name") or "").strip()
        kod = (row.get("ref_kod") or "").strip()
        value = (row.get("ref_value") or "").strip()
        if not name or not kod:
            continue
        by_name[name].append(
            {
                "kod": kod,
                "value": value or kod,
                "note": row.get("ref_note") or None,
            }
        )
    for name in by_name:
        by_name[name].sort(key=lambda x: x["value"].lower())
    return {
        "version": "1.0",
        "source": MDB.name,
        "total": sum(len(v) for v in by_name.values()),
        "groups": len(by_name),
        "byName": dict(sorted(by_name.items())),
    }


def export_t_ras_fixture() -> dict:
    raw = mdb_export("t_ras")
    entries = []
    for row in csv.DictReader(io.StringIO(raw)):
        tname = (row.get("tname") or "").strip()
        if not tname.startswith("N"):
            continue
        rowno = parse_int(row.get("rowno"))
        if rowno is None:
            continue
        col = (row.get("fname") or "B").strip().upper()
        values: dict[str, float] = {}
        for letter in "BCDEFGHIJKLMNOPQRSTUVWXYZ":
            v = row.get(letter)
            if v is None or str(v).strip() == "":
                continue
            try:
                values[letter] = float(str(v).replace(",", "."))
            except ValueError:
                pass
        if not values:
            continue
        entries.append(
            {
                "formId": tname,
                "parentRowNo": rowno,
                "columnKey": col,
                "kontrName": (row.get("org") or "").strip(),
                "inn": row.get("inn") or None,
                "kpp": row.get("kpp") or None,
                "orgType": parse_int(row.get("orgType")),
                "values": values,
            }
        )
    return {
        "version": "1.0",
        "source": MDB.name,
        "total": len(entries),
        "entries": entries,
    }


def main() -> int:
    if not MDB.exists():
        print(f"MDB not found: {MDB}", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)

    kontr = export_kontr()
    refs = export_refs()
    fixture = export_t_ras_fixture()
    (OUT / "kontr.json").write_text(
        json.dumps(kontr, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (OUT / "rash-refs.json").write_text(
        json.dumps(refs, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    fixture_dir = ROOT / "portal" / "src" / "engine" / "fixtures"
    fixture_dir.mkdir(parents=True, exist_ok=True)
    (fixture_dir / "t-ras-sample.json").write_text(
        json.dumps(fixture, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"kontr.json: {kontr['total']} agents")
    print(f"rash-refs.json: {refs['total']} items in {refs['groups']} groups")
    print(f"t-ras-sample.json: {fixture['total']} entries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
