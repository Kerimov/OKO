import pyodbc

c = pyodbc.connect(
    r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};"
    r"DBQ=c:\OKO\reference\z261.mdb;PWD=12345;"
)
cur = c.cursor()
cur.execute(
    "SELECT TOP 8 FormName, ExcelSheetName, ExcelRow, ExcelColumn, FormColumn, FormRow "
    "FROM tblExcelExport WHERE FormName='N01_1'"
)
for r in cur.fetchall():
    print(r)

cur.execute("SELECT LExpCheck FROM a_tblchecks WHERE LExpCheck LIKE '%<>%'")
for r in cur.fetchall():
    print("<>", r[0][:100])

cur.execute("SELECT LExpCheck FROM a_tblchecks WHERE LExpCheck LIKE '%*%'")
for r in cur.fetchall()[:3]:
    print("*", r[0][:120])
