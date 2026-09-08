import pyodbc

conn = pyodbc.connect(
    r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};"
    r"DBQ=c:\OKO\12345\z261.mdb;PWD=12345;"
)
cur = conn.cursor()

print("=== a_stblFIELDs N01_1 ===")
cur.execute("SELECT Pos, FName, Ftype, FWidth, FCaption, HiHeaderText FROM a_stblFIELDs WHERE TName='N01_1' ORDER BY Pos")
for r in cur.fetchall():
    print(r)

print("\n=== a_stblFIELDs N01_2 ===")
cur.execute("SELECT Pos, FName, Ftype, FCaption FROM a_stblFIELDs WHERE TName='N01_2' ORDER BY Pos")
for r in cur.fetchall():
    print(r)

print("\n=== FormCorrespondence all ===")
cur.execute("SELECT Tname, GosForm, str, npp FROM FormCorrespondence ORDER BY npp")
for r in cur.fetchall():
    print(r)

print("\n=== tblExcelExport form title? ===")
cur.execute("SELECT TOP 3 FormName, ExcelSheetName FROM tblExcelExport WHERE FormName='N01_1'")
for r in cur.fetchall():
    print(r)

print("\n=== a_stblROWs first row per form (title hint) ===")
cur.execute(
    "SELECT TName, MIN(Sort), MIN(RowName) FROM a_stblROWs WHERE TName IN ('N01_111','N01_54','N14_11') GROUP BY TName"
)
for r in cur.fetchall():
    print(r)

conn.close()
