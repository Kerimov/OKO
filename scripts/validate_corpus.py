#!/usr/bin/env python3
"""Validate portal/public/data corpus sizes and required keys."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "portal" / "public" / "data"

MIN_KONTR = 10  # sample MDB has 13; production should be much larger
MIN_CHECKS = 100
MIN_SALDO = 1000
MIN_REORG = 100
MIN_RASH = 50


def load_json(name: str) -> dict | list:
    path = DATA / name
    if not path.exists():
        raise FileNotFoundError(path)
    return json.loads(path.read_text(encoding="utf-8"))


def as_list(data: dict | list, *keys: str) -> list | None:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in keys:
            val = data.get(key)
            if isinstance(val, list):
                return val
    return None


def main() -> int:
    errors: list[str] = []
    warnings: list[str] = []

    kontr = load_json("kontr.json")
    items = as_list(kontr, "items", "agents")
    if items is None:
        errors.append("kontr.json: missing items[] / agents[]")
    else:
        if len(items) < MIN_KONTR:
            warnings.append(
                f"kontr.json: only {len(items)} agents "
                f"(expected production corpus >> {MIN_KONTR})"
            )
        elif len(items) < 1000:
            warnings.append(
                f"kontr.json: {len(items)} agents — sample-sized; "
                "production ОБДНСИ export usually has thousands"
            )
        sample = items[0] if items else {}
        if isinstance(sample, dict):
            for key in ("id", "name"):
                if key not in sample:
                    errors.append(f"kontr.json: item missing {key}")
            # Prefer OBДНСИ GUID when present in richer corpora
            if len(items) >= 1000 and "idOBDNSI" not in sample and "guid" not in sample:
                warnings.append(
                    "kontr.json: large corpus without idOBDNSI/guid — check Excel/MDB export"
                )

    checks = load_json("checks.json")
    crules = as_list(checks, "checks", "rules")
    if crules is None:
        errors.append("checks.json: missing checks[]")
    elif len(crules) < MIN_CHECKS:
        warnings.append(f"checks.json: {len(crules)} rules (< {MIN_CHECKS})")

    try:
        reorg = load_json("checks-reorg.json")
        rrules = as_list(reorg, "checks")
        if rrules is None:
            errors.append("checks-reorg.json: missing checks[]")
        elif len(rrules) < MIN_REORG:
            warnings.append(f"checks-reorg.json: {len(rrules)} rules (< {MIN_REORG})")
        else:
            variants = {r.get("variant") for r in rrules if isinstance(r, dict)}
            if not ({2, 3} <= variants):
                warnings.append(
                    f"checks-reorg.json: expected variants 2 and 3, got {sorted(variants)}"
                )
    except FileNotFoundError:
        warnings.append("checks-reorg.json: missing (CheckItReorg* unavailable)")

    saldo = load_json("saldo-rules.json")
    srules = as_list(saldo, "rules")
    if srules is None:
        errors.append("saldo-rules.json: missing rules[]")
    elif len(srules) < MIN_SALDO:
        warnings.append(f"saldo-rules.json: {len(srules)} rules (< {MIN_SALDO})")

    try:
        rash = load_json("rash-rules.json")
        rash_rules = as_list(rash, "rules")
        if rash_rules is None:
            errors.append("rash-rules.json: missing rules[]")
        elif len(rash_rules) < MIN_RASH:
            warnings.append(f"rash-rules.json: {len(rash_rules)} rules (< {MIN_RASH})")
    except FileNotFoundError:
        warnings.append("rash-rules.json: missing")

    loans = load_json("loans-nzs-refs.json")
    if isinstance(loans, dict):
        groups = loans.get("groups")
        if not isinstance(groups, dict) or len(groups) == 0:
            warnings.append("loans-nzs-refs.json: missing groups")
        elif "Крупнейшие заёмные средства" not in groups and "Объекты НЗС" not in groups:
            warnings.append("loans-nzs-refs.json: expected loans/NZS group names")

    try:
        corr = load_json("form-correspondence.json")
        forms = as_list(corr, "forms")
        if forms is None:
            warnings.append("form-correspondence.json: missing forms[]")
        elif len(forms) == 0:
            warnings.append("form-correspondence.json: empty forms[]")
    except FileNotFoundError:
        warnings.append("form-correspondence.json: missing")

    for w in warnings:
        print(f"WARN {w}")
    for e in errors:
        print(f"ERROR {e}")

    if errors:
        return 1
    print("corpus validation: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
