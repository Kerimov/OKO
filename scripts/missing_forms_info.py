import json
import re
from pathlib import Path

import pyodbc

ROOT = Path(__file__).resolve().parent.parent
conn = pyodbc.connect(
    rf"DRIVER={{Microsoft Access Driver (*.mdb, *.accdb)}};"
    rf"DBQ={ROOT / '12345' / 'z261.mdb'};PWD=12345;"
)
cur = conn.cursor()

forms = [
    "N01_111", "N01_54", "N14_11", "N14_12", "ND6", "ND7", "N05_4",
    "N01_32", "N01_33", "N02_6", "ND1", "ND5",
    "N01_512", "N01_514", "N01_55", "N01_56", "N01_6",
    "N02_5", "N02_19", "N02_31", "N03_3", "N13_10", "N13_21", "ND8",
]

print(f"{'Form':<12} {'rows':>5} {'flds':>5} {'tbl':>4} {'excel':>6}  sample row name")
for f in forms:
    cur.execute("SELECT COUNT(*) FROM a_stblROWs WHERE TName=?", f)
    rows = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM a_stblFIELDs WHERE TName=?", f)
    flds = cur.fetchone()[0]
    try:
        cur.execute(f"SELECT COUNT(*) FROM [{f}]")
        tbl = cur.fetchone()[0]
    except Exception:
        tbl = -1
    cur.execute("SELECT COUNT(*) FROM tblExcelExport WHERE FormName=?", f)
    excel = cur.fetchone()[0]
    cur.execute(
        "SELECT TOP 1 RowName FROM a_stblROWs WHERE TName=? ORDER BY Sort", f
    )
    sample = cur.fetchone()
    sample = sample[0][:50] if sample and sample[0] else "-"
    print(f"{f:<12} {rows:>5} {flds:>5} {tbl:>4} {excel:>6}  {sample}")

conn.close()
