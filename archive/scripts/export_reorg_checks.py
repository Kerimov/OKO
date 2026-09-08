#!/usr/bin/env python3
"""Export Access CheckItReorg* catalogues → portal/public/data/checks-reorg.json."""

from __future__ import annotations

import csv
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "portal" / "public" / "data" / "checks-reorg.json"
RASH_REFS = ROOT / "portal" / "public" / "data" / "rash-refs.json"
MDE = ROOT / "12345" / "OKO26-1.m_e"


def add(
    rules: list,
    variant: int,
    number,
    expression,
    message=None,
    reorg=None,
    fialkina=None,
    source=None,
    expression_alt=None,
):
    if not expression or not str(expression).strip():
        return
    item = {
        "variant": variant,
        "number": int(number) if str(number).isdigit() else number,
        "expression": str(expression).strip(),
        "expressionAlt": str(expression_alt).strip() if expression_alt else None,
        "message": message or None,
        "reorg": reorg or None,
        "fialkina": fialkina,
        "source": source,
    }
    rules.append(item)


def from_rash_refs(rules: list) -> None:
    if not RASH_REFS.exists():
        print(f"warn: missing {RASH_REFS}", file=sys.stderr)
        return
    rash = json.loads(RASH_REFS.read_text(encoding="utf-8"))
    for name, variant in (("a_tblchecks_Reorg2", 2), ("a_tblchecks_Reorg3", 3)):
        for item in rash.get("byName", {}).get(name, []):
            add(
                rules,
                variant,
                item.get("kod"),
                item.get("value"),
                item.get("note"),
                source="refs",
            )


def from_mde_table(rules: list, table: str, variant: int) -> int:
    if not MDE.exists():
        print(f"warn: missing {MDE}", file=sys.stderr)
        return 0
    raw = subprocess.check_output(
        ["mdb-export", str(MDE), table], text=True, errors="replace"
    )
    reader = csv.DictReader(raw.splitlines())
    n = 0
    for row in reader:
        add(
            rules,
            variant,
            row.get("Number"),
            row.get("LExpCheck"),
            row.get("MessageText") or None,
            row.get("Reorg") or None,
            row.get("Fialkina") or None,
            source=table,
            expression_alt=row.get("LExpCheck1"),
        )
        n += 1
    return n


def main() -> None:
    rules: list = []
    from_rash_refs(rules)
    n1 = from_mde_table(rules, "a_tblchecks_Reorg", 1)
    n4 = from_mde_table(rules, "a_tblchecks_Reorg4", 4)
    by_v: dict[int, int] = defaultdict(int)
    for r in rules:
        by_v[r["variant"]] += 1
    payload = {
        "version": "1.0",
        "source": "z261 refs + OKO26-1.m_e Reorg tables",
        "total": len(rules),
        "byVariant": {str(k): v for k, v in sorted(by_v.items())},
        "checks": rules,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"checks-reorg.json: {len(rules)} rules {dict(by_v)} (mde Reorg={n1}, Reorg4={n4})")


if __name__ == "__main__":
    main()
