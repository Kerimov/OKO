import pyodbc

conn = pyodbc.connect(
    r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};"
    r"DBQ=c:\OKO\12345\z261.mdb;PWD=12345;"
)
cur = conn.cursor()

for form in ["N01_1", "N06_11", "N05_1"]:
    print(f"\n=== {form} table columns ===")
    cols = [c.column_name for c in cur.columns(table=form)]
    print(cols)
    cur.execute(f"SELECT Pos, FName, Ftype, FCaption FROM a_stblFIELDs WHERE TName='{form}' ORDER BY Pos")
    print("fields:", cur.fetchall())

print("\n=== Excel sheet names per form ===")
cur.execute(
    "SELECT FormName, MIN(ExcelSheetName) FROM tblExcelExport GROUP BY FormName ORDER BY FormName"
)
for r in cur.fetchall():
    print(r[0], "->", r[1])

conn.close()
