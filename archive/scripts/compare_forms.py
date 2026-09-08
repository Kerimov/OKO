"""Compare portal forms with MDB tables and metadata."""
import json
import re
import sys
from pathlib import Path

try:
    import pyodbc
except ImportError:
    print("pyodbc not installed")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
MDB = ROOT / "12345" / "z261.mdb"
MDE = ROOT / "12345" / "OKO26-1.mde"
CATALOG = ROOT / "portal" / "public" / "schemas" / "catalog.json"


def load_portal_forms():
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    return {f["id"] for f in data["forms"]}


def load_mdb_forms():
    conn = pyodbc.connect(
        rf"DRIVER={{Microsoft Access Driver (*.mdb, *.accdb)}};"
        rf"DBQ={MDB};PWD=12345;"
    )
    cur = conn.cursor()

    tables = sorted(
        r.table_name
        for r in cur.tables(tableType="TABLE")
        if re.match(r"^(N\d|ND)", r.table_name)
    )

    def distinct(col, table, where=""):
        q = f"SELECT DISTINCT {col} FROM {table} {where} ORDER BY {col}"
        return [r[0] for r in cur.execute(q).fetchall() if r[0]]

    rows_forms = distinct("TName", "a_stblROWs", "WHERE TName LIKE 'N%'")
    fields_forms = distinct("TName", "a_stblFIELDs", "WHERE TName LIKE 'N%'")
    excel_forms = distinct("FormName", "tblExcelExport", "WHERE FormName LIKE 'N%'")
    fc_forms = distinct("Tname", "FormCorrespondence")

    conn.close()
    return {
        "tables": set(tables),
        "a_stblROWs": set(rows_forms),
        "a_stblFIELDs": set(fields_forms),
        "tblExcelExport": set(excel_forms),
        "FormCorrespondence": set(fc_forms),
    }


def load_mde_forms():
    if not MDE.exists():
        return set()
    data = MDE.read_bytes()
    # Access stores form names as ASCII/UTF-16LE strings
    text = data.decode("latin-1", errors="ignore")
    forms = set(re.findall(r"frm_(N[A-Z0-9_]+|ND\d+)", text, re.I))
    # normalize case
    return {f.upper().replace("FRM_", "") if f.lower().startswith("frm_") else f for f in forms}


def normalize_mde(raw):
    out = set()
    for f in raw:
        name = f
        if name.lower().startswith("frm_"):
            name = name[4:]
        out.add(name)
    return out


def main():
    portal = load_portal_forms()
    mdb = load_mdb_forms()
    mde_raw = load_mde_forms()
    mde = normalize_mde(mde_raw)

    # MDE pattern might capture frm_N01_1 etc - re-extract properly
    data = MDE.read_bytes()
    text = data.decode("latin-1", errors="ignore")
    mde = set(re.findall(r"frm_(N[0-9A-Z_]+|ND[0-9]+)", text, re.I))
    mde = {x for x in mde if not x.startswith("N0") or "_" in x or len(x) <= 6}
    # filter false positives - keep only valid form codes
    valid = re.compile(r"^(N\d{2}_[\dA-Z]+|ND\d+)$")
    mde = {x for x in mde if valid.match(x)}

    mdb_all = mdb["tables"]
    mdb_meta = mdb["a_stblROWs"] | mdb["a_stblFIELDs"]

    print("=== COUNTS ===")
    print(f"Portal:              {len(portal)}")
    print(f"MDB tables:          {len(mdb_all)}")
    print(f"MDB a_stblROWs:      {len(mdb['a_stblROWs'])}")
    print(f"MDB tblExcelExport:  {len(mdb['tblExcelExport'])}")
    print(f"MDB FormCorresp.:    {len(mdb['FormCorrespondence'])}")
    print(f"MDE frm_* (extract): {len(mde)}")

    def report(title, only_in_a, only_in_b, label_a, label_b):
        if only_in_a or only_in_b:
            print(f"\n=== {title} ===")
            if only_in_a:
                print(f"  Only in {label_a} ({len(only_in_a)}):")
                for x in sorted(only_in_a):
                    print(f"    + {x}")
            if only_in_b:
                print(f"  Only in {label_b} ({len(only_in_b)}):")
                for x in sorted(only_in_b):
                    print(f"    - {x}")

    report("Portal vs MDB tables", portal - mdb_all, mdb_all - portal, "portal", "MDB")
    report("Portal vs MDB metadata (rows)", portal - mdb_meta, mdb_meta - portal, "portal", "MDB rows")
    report("Portal vs MDE forms", portal - mde, mde - portal, "portal", "MDE")
    report("MDB tables vs MDE", mdb_all - mde, mde - mdb_all, "MDB", "MDE")

    common = portal & mdb_all
    print(f"\n=== COVERAGE ===")
    print(f"Portal forms with MDB table: {len(common)}/{len(portal)} ({100*len(common)/len(portal):.0f}%)")
    print(f"Portal forms with MDE frm_*: {len(portal & mde)}/{len(portal)} ({100*len(portal & mde)/len(portal):.0f}%)")

    # row counts comparison for common forms
    conn = pyodbc.connect(
        rf"DRIVER={{Microsoft Access Driver (*.mdb, *.accdb)}};"
        rf"DBQ={MDB};PWD=12345;"
    )
    cur = conn.cursor()
    print("\n=== ROW COUNTS (portal schema vs MDB) ===")
    print(f"{'Form':<12} {'Portal rows':>12} {'MDB rows':>10} {'MDB meta rows':>14}")
    for fid in sorted(common):
        schema_path = ROOT / "portal" / "public" / "schemas" / f"{fid}.json"
        portal_rows = 0
        if schema_path.exists():
            s = json.loads(schema_path.read_text(encoding="utf-8"))
            portal_rows = len(s.get("rows", []))
        try:
            cur.execute(f"SELECT COUNT(*) FROM [{fid}]")
            mdb_rows = cur.fetchone()[0]
        except Exception:
            mdb_rows = -1
        cur.execute("SELECT COUNT(*) FROM a_stblROWs WHERE TName=?", fid)
        meta_rows = cur.fetchone()[0]
        flag = " ***" if portal_rows and meta_rows and abs(portal_rows - meta_rows) > 5 else ""
        print(f"{fid:<12} {portal_rows:>12} {mdb_rows:>10} {meta_rows:>14}{flag}")
    conn.close()


if __name__ == "__main__":
    main()
