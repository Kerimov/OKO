"""Detailed gap analysis between portal and legacy OKO."""
import json
import re
import sys
from pathlib import Path

import pyodbc

ROOT = Path(__file__).resolve().parent.parent
MDB = ROOT / "12345" / "z261.mdb"
MDE = ROOT / "12345" / "OKO26-1.mde"
CATALOG = ROOT / "portal" / "public" / "schemas" / "catalog.json"


def connect():
    return pyodbc.connect(
        rf"DRIVER={{Microsoft Access Driver (*.mdb, *.accdb)}};"
        rf"DBQ={MDB};PWD=12345;"
    )


def mde_forms():
    text = MDE.read_bytes().decode("latin-1", errors="ignore")
    return sorted(
        set(re.findall(r"frm_(N\d{2}_[0-9A-Z]+|ND\d+)(?:[^0-9A-Z_]|$)", text, re.I))
    )


def main():
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    portal = {f["id"] for f in catalog["forms"]}
    mde = set(mde_forms())

    conn = connect()
    cur = conn.cursor()
    tables = {
        r.table_name
        for r in cur.tables(tableType="TABLE")
        if re.match(r"^(N|ND)", r.table_name)
    }
    cur.execute("SELECT DISTINCT TName FROM a_stblROWs WHERE TName LIKE 'N%'")
    meta = {r[0] for r in cur.fetchall()}

    portal_only = sorted(portal - tables)
    mdb_only = sorted(tables - portal)
    meta_only = sorted(meta - tables)

    print("=== PORTAL-ONLY (no MDB table) ===")
    for f in portal_only:
        cur.execute("SELECT COUNT(*) FROM a_stblROWs WHERE TName=?", f)
        rows = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM a_stblFIELDs WHERE TName=?", f)
        fields = cur.fetchone()[0]
        print(f"  {f}: meta_rows={rows}, meta_fields={fields}, mde={f in mde}")

    print("\n=== MDB-ONLY (not in portal) ===")
    for f in mdb_only:
        cur.execute("SELECT COUNT(*) FROM a_stblROWs WHERE TName=?", f)
        rows = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM a_stblFIELDs WHERE TName=?", f)
        fields = cur.fetchone()[0]
        cur.execute(
            "SELECT TOP 1 Tname, Show, New, str FROM FormCorrespondence WHERE Tname=?",
            f,
        )
        fc = cur.fetchone()
        print(f"  {f}: meta_rows={rows}, meta_fields={fields}, mde={f in mde}, FC={fc}")

    print("\n=== META ONLY (a_stblROWs, no table) ===")
    for f in meta_only:
        cur.execute("SELECT COUNT(*) FROM a_stblROWs WHERE TName=?", f)
        rows = cur.fetchone()[0]
        print(f"  {f}: meta_rows={rows}, portal={f in portal}, mde={f in mde}")

    print("\n=== MDE SUBFORMS (page variants, not in portal/MDB) ===")
    subforms = sorted(
        f
        for f in mde
        if f not in portal
        and f not in tables
        and re.search(r"[A-Z]$", f.split("_")[-1])
    )
    for f in subforms:
        print(f"  {f}")

    print("\n=== ROW TEMPLATE QUALITY (portal vs a_stblROWs) ===")
    match = close = mismatch = empty = 0
    bad = []
    for fid in sorted(portal & tables):
        schema = json.loads(
            (ROOT / "portal" / "public" / "schemas" / f"{fid}.json").read_text(
                encoding="utf-8"
            )
        )
        pr = len(schema.get("rows", []))
        cur.execute("SELECT COUNT(*) FROM a_stblROWs WHERE TName=?", fid)
        mr = cur.fetchone()[0]
        if pr == 0:
            empty += 1
        elif pr == mr:
            match += 1
        elif abs(pr - mr) <= 3:
            close += 1
        else:
            mismatch += 1
            bad.append((fid, pr, mr))

    print(f"  exact match: {match}")
    print(f"  close (±3):  {close}")
    print(f"  mismatch:    {mismatch}")
    print(f"  empty portal rows: {empty}")
    if bad:
        print("  largest gaps:")
        for fid, pr, mr in sorted(bad, key=lambda x: abs(x[1] - x[2]), reverse=True)[:12]:
            print(f"    {fid}: portal={pr}, mdb={mr}")

    print("\n=== MDE FORM GROUPS ===")
    groups = {}
    for f in mde:
        g = f.split("_")[0]
        groups.setdefault(g, []).append(f)
    for g in sorted(groups):
        in_portal = sum(1 for f in groups[g] if f in portal)
        print(f"  {g}: mde={len(groups[g])}, portal={in_portal}")

    conn.close()


if __name__ == "__main__":
    main()
