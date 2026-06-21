import json
import pyodbc
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MDB = ROOT / "12345" / "z261.mdb"
conn = pyodbc.connect(rf"DRIVER={{Microsoft Access Driver (*.mdb, *.accdb)}};DBQ={MDB};PWD=12345;")
cur = conn.cursor()

for table in ["a_tblchecks", "tblExcelExport", "FormCorrespondence", "a_tblsaldo"]:
    print(f"\n=== {table} columns ===")
    print([c.column_name for c in cur.columns(table=table)])
    cur.execute(f"SELECT TOP 2 * FROM [{table}]")
    print([d[0] for d in cur.description])
    for r in cur.fetchall():
        print(r)

cur.execute("SELECT COUNT(*) FROM a_tblchecks WHERE aktiv=True")
print("\nactive checks:", cur.fetchone()[0])

cur.execute("SELECT TOP 10 Number, LExpCheck, MessageText, aktiv FROM a_tblchecks WHERE aktiv=True ORDER BY Number")
print("\n=== sample checks ===")
for r in cur.fetchall():
    print(r)

conn.close()
