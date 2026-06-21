import pyodbc
from collections import Counter

c = pyodbc.connect(
    r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};"
    r"DBQ=c:\OKO\reference\z261.mdb;PWD=12345;"
)
cur = c.cursor()

cur.execute("SELECT kod FROM a_stblROWs WHERE kod IS NOT NULL AND kod <> ''")
samples = []
for (k,) in cur.fetchall():
    k = str(k).strip()
    if ("+" in k or "-" in k) and len(samples) < 10:
        samples.append(k)
print("formula samples:", samples)

cur.execute("SELECT znak, COUNT(*) FROM a_stblROWs GROUP BY znak")
print("znak:", cur.fetchall()[:10])

cur.execute("SELECT TOP 3 RowNo, RowName, kod, znak, Columns FROM a_stblROWs WHERE TName='N01_1' AND kod LIKE '%+%'")
for r in cur.fetchall():
    print("row", r)

cur.execute("SELECT COUNT(*) FROM sp_kontr")
print("kontr", cur.fetchone()[0])

cur.execute("SELECT LExpCheck FROM a_tblchecks")
ops = Counter()
for (e,) in cur.fetchall():
    if not e:
        continue
    s = str(e)
    for op in ("<>", "*", "/", "Sum", "IIf", "Abs"):
        if op in s:
            ops[op] += 1
print("check ops", dict(ops))
