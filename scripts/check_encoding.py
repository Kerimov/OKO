import pyodbc
import re

c = pyodbc.connect(
    r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};"
    r"DBQ=c:\OKO\12345\z261.mdb;PWD=12345;"
)
cur = c.cursor()
cur.execute("SELECT LExpCheck FROM a_tblchecks WHERE Number=76")
r = cur.fetchone()[0]
cols = re.findall(r'Cell\("[^"]+","([^"]+)"', r)
print("columns in expr:", cols)
for col in cols:
    print(" ", col, [hex(ord(ch)) for ch in col])

cur.execute("SELECT FName FROM a_stblFIELDs WHERE TName='N01_01' ORDER BY Pos")
print("field names:", [row[0] for row in cur.fetchall()])
