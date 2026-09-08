import pyodbc

conn = pyodbc.connect(
    r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};"
    r"DBQ=c:\OKO\12345\z261.mdb;PWD=12345;"
)
cur = conn.cursor()
for t in ["TABLE", "VIEW", "SYSTEM TABLE"]:
    rows = [r.table_name for r in cur.tables(tableType=t) if r.table_name == "N02_6"]
    if rows:
        print(t, rows)

try:
    cur.execute("SELECT COUNT(*) FROM [N02_6]")
    print("N02_6 count:", cur.fetchone()[0])
except Exception as e:
    print("N02_6 query error:", e)

conn.close()
