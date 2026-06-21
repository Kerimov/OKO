import pyodbc

conn = pyodbc.connect(
    r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};"
    r"DBQ=c:\OKO\12345\z261.mdb;PWD=12345;"
)
cur = conn.cursor()

for form in ["N01_01", "N06_11", "N05_1", "N01_111", "N14_11"]:
    print(f"\n=== {form} ===")
    cur.execute(
        "SELECT Pos, FName, Ftype, FCaption FROM a_stblFIELDs WHERE TName=? ORDER BY Pos",
        form,
    )
    print("fields:", cur.fetchall())
    cur.execute(
        "SELECT COUNT(*) FROM a_stblROWs WHERE TName=?", form
    )
    print("rows:", cur.fetchone()[0])
    cur.execute(
        "SELECT TOP 3 RowNo, RowName, kod FROM a_stblROWs WHERE TName=? ORDER BY Sort",
        form,
    )
    for r in cur.fetchall():
        print(" ", r)

conn.close()
