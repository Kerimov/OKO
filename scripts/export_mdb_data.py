#!/usr/bin/env python3
"""Export OKO legacy data from z261.mdb to portal/public/data/."""
from __future__ import annotations

import json
import re
from pathlib import Path

import pyodbc

ROOT = Path(__file__).resolve().parent.parent
MDB = ROOT / "reference" / "z261.mdb"
if not MDB.exists():
    MDB = ROOT / "12345" / "z261.mdb"
OUT = ROOT / "portal" / "public" / "data"


def connect():
    return pyodbc.connect(
        rf"DRIVER={{Microsoft Access Driver (*.mdb, *.accdb)}};"
        rf"DBQ={MDB};PWD=12345;"
    )


def row_to_dict(cursor, row) -> dict:
    return {desc[0]: row[i] for i, desc in enumerate(cursor.description)}


def export_checks(cur) -> dict:
    cur.execute(
        "SELECT Number, LExpCheck, LExpCheck1, MessageText, "
        "ForAggrOnly, FirstLevel, aktiv, pg_aktiv, Period, Info "
        "FROM a_tblchecks ORDER BY Number"
    )
    checks = []
    active = 0
    for row in cur.fetchall():
        d = row_to_dict(cur, row)
        for key, val in d.items():
            if isinstance(val, bool):
                continue
            if val is None:
                d[key] = None
            elif isinstance(val, float) and val == int(val):
                d[key] = int(val)
            else:
                d[key] = val
        if d.get("aktiv") or d.get("pg_aktiv"):
            active += 1
        checks.append(
            {
                "number": d["Number"],
                "expression": d["LExpCheck"] or "",
                "expressionAlt": d.get("LExpCheck1"),
                "message": d.get("MessageText"),
                "forAggrOnly": bool(d.get("ForAggrOnly")),
                "firstLevel": bool(d.get("FirstLevel")),
                "active": bool(d.get("aktiv")),
                "periodActive": bool(d.get("pg_aktiv")),
                "period": d.get("Period"),
                "info": d.get("Info"),
            }
        )
    return {
        "version": "1.0",
        "source": str(MDB.name),
        "total": len(checks),
        "activeCount": active,
        "checks": checks,
    }


def export_excel(cur) -> dict:
    cur.execute(
        "SELECT FormName, ExcelSheetName, ExcelRow, ExcelColumn, "
        "FormColumn, FormRow, period, addText "
        "FROM tblExcelExport ORDER BY FormName, id"
    )
    rows = []
    for row in cur.fetchall():
        d = row_to_dict(cur, row)
        rows.append(
            {
                "formName": d["FormName"],
                "sheetName": d["ExcelSheetName"],
                "excelRow": int(d["ExcelRow"]) if d["ExcelRow"] is not None else None,
                "excelColumn": d["ExcelColumn"],
                "formColumn": d["FormColumn"],
                "formRow": int(d["FormRow"]) if d["FormRow"] is not None else None,
                "period": bool(d.get("period")),
                "addText": d.get("addText"),
            }
        )
    by_form: dict[str, int] = {}
    for r in rows:
        by_form[r["formName"]] = by_form.get(r["formName"], 0) + 1
    return {
        "version": "1.0",
        "source": str(MDB.name),
        "total": len(rows),
        "formsCount": len(by_form),
        "mappings": rows,
    }


def export_saldo(cur) -> dict:
    cur.execute(
        "SELECT Number, Ntbl_t, Ftbl_t, Stbl_t, Ntbl_s, Ftbl_s, Stbl_s, "
        "Ntbl_g, Ftbl_g, Stbl_g, saldo_t, saldo_s, saldo_g, name, usl, kontr "
        "FROM a_tblsaldo ORDER BY Number"
    )
    rules = []
    for row in cur.fetchall():
        d = row_to_dict(cur, row)
        rules.append(
            {
                "number": d["Number"],
                "targetForm": d["Ntbl_t"],
                "targetColumn": d["Ftbl_t"],
                "targetRow": int(d["Stbl_t"]) if d["Stbl_t"] is not None else None,
                "sourceForm": d["Ntbl_s"],
                "sourceColumn": d["Ftbl_s"],
                "sourceRow": int(d["Stbl_s"]) if d["Stbl_s"] is not None else None,
                "endForm": d["Ntbl_g"],
                "endColumn": d["Ftbl_g"],
                "endRow": int(d["Stbl_g"]) if d["Stbl_g"] is not None else None,
                "saldoT": bool(d.get("saldo_t")),
                "saldoS": bool(d.get("saldo_s")),
                "saldoG": bool(d.get("saldo_g")),
                "name": d.get("name"),
                "conditional": bool(d.get("usl")),
            }
        )
    return {
        "version": "1.0",
        "source": str(MDB.name),
        "total": len(rules),
        "rules": rules,
    }


def export_row_formulas(cur) -> dict:
    cur.execute(
        "SELECT TName, RowNo, kod, znak FROM a_stblROWs "
        "WHERE kod IS NOT NULL AND kod <> '' AND (kod LIKE '%+%' OR kod LIKE '%-%') "
        "ORDER BY TName, Sort"
    )
    by_form: dict[str, list] = {}
    for row in cur.fetchall():
        d = row_to_dict(cur, row)
        form = d["TName"]
        kod = str(d["kod"]).strip()
        if not kod or not any(c in kod for c in "+-"):
            continue
        by_form.setdefault(form, []).append(
            {
                "rowNo": int(d["RowNo"]) if d["RowNo"] is not None else None,
                "formula": kod,
                "sign": d.get("znak"),
            }
        )
    total = sum(len(v) for v in by_form.values())
    return {
        "version": "1.0",
        "source": str(MDB.name),
        "formsCount": len(by_form),
        "total": total,
        "byForm": by_form,
    }


def export_recalc_rules(cur) -> dict:
    cur.execute(
        "SELECT TName, RowNo, kod, znak, Columns FROM a_stblROWs ORDER BY TName, Sort"
    )
    by_form: dict[str, list] = {}
    for row in cur.fetchall():
        d = row_to_dict(cur, row)
        form = d["TName"]
        row_no = int(d["RowNo"]) if d.get("RowNo") is not None else None
        if row_no is None:
            continue
        kod = str(d.get("kod") or "").strip()
        cols = str(d.get("Columns") or "").strip()
        rules = by_form.setdefault(form, [])
        if kod and re.search(r"[+-]", kod):
            rules.append({"kind": "rows", "rowNo": row_no, "formula": kod, "sign": d.get("znak")})
        elif kod and re.match(r"^\d+$", kod):
            rules.append({"kind": "copyRow", "rowNo": row_no, "sourceRow": int(kod)})
        if cols:
            rules.append({"kind": "columnSum", "rowNo": row_no, "columns": cols})

    cur.execute(
        "SELECT TName, Pos, FName, Ftype, FTotal, FCaption FROM a_stblFIELDs ORDER BY TName, Pos"
    )
    skip = {"ZID", "EID", "Sort", "Number", "Name"}
    fields_by_form: dict[str, list] = {}
    for row in cur.fetchall():
        d = row_to_dict(cur, row)
        if d["FName"] in skip:
            continue
        fields_by_form.setdefault(d["TName"], []).append(d)

    for form, flist in fields_by_form.items():
        for i, f in enumerate(flist):
            if str(f.get("FTotal") or "") not in ("1", "True", "-1"):
                continue
            cap = str(f.get("FCaption") or "").lower()
            sources = []
            for prev in flist[:i]:
                if str(prev.get("Ftype") or "") != "4":
                    continue
                pc = str(prev.get("FCaption") or "").lower()
                if "дебет" in cap and "дебет" in pc:
                    sources.append(prev["FName"])
                elif "кредит" in cap and "кредит" in pc:
                    sources.append(prev["FName"])
            if sources:
                by_form.setdefault(form, []).append(
                    {"kind": "horizontalSum", "column": f["FName"], "sourceColumns": sources}
                )

    total = sum(len(v) for v in by_form.values())
    return {
        "version": "2.0",
        "source": str(MDB.name),
        "formsCount": len(by_form),
        "total": total,
        "byForm": by_form,
    }


def export_rash(cur) -> dict:
    cur.execute(
        "SELECT kod, rName, rNote, rItogo, ref_rows, "
        "ref_a1_name, ref_a1_title, ref_a2_name, ref_a2_title, "
        "ref_a3_name, ref_a3_title, ref_a4_name, ref_a4_title "
        "FROM sp_rash ORDER BY kod"
    )
    rules = []
    for row in cur.fetchall():
        d = row_to_dict(cur, row)
        rules.append(
            {
                "kod": int(d["kod"]) if d["kod"] is not None else 0,
                "name": d.get("rName") or "",
                "note": d.get("rNote"),
                "refRows": d.get("ref_rows"),
                "totalFormula": d.get("rItogo"),
                "refA1Name": d.get("ref_a1_name"),
                "refA1Title": d.get("ref_a1_title"),
                "refA2Name": d.get("ref_a2_name"),
                "refA2Title": d.get("ref_a2_title"),
                "refA3Name": d.get("ref_a3_name"),
                "refA3Title": d.get("ref_a3_title"),
                "refA4Name": d.get("ref_a4_name"),
                "refA4Title": d.get("ref_a4_title"),
            }
        )

    cur.execute("SELECT kod, Sort, sum_title, fld_type FROM sp_rash_addsum ORDER BY kod, Sort")
    addsum = []
    for row in cur.fetchall():
        d = row_to_dict(cur, row)
        addsum.append(
            {
                "kod": int(d["kod"]) if d["kod"] is not None else 0,
                "sort": int(d["Sort"]) if d.get("Sort") is not None else 0,
                "sumTitle": d.get("sum_title") or "",
                "fldType": d.get("fld_type") or "Сумма",
            }
        )

    return {
        "version": "1.0",
        "source": str(MDB.name),
        "total": len(rules),
        "rules": rules,
        "addsum": addsum,
        "thresholds": {
            "level1": 1,
            "level2": 5000,
            "level3": 50000,
            "unit": "тыс.руб.",
            "labels": ["1 тыс. руб.", "5 млн руб.", "50 млн руб."],
        },
    }


def export_kontr(cur) -> dict:
    cur.execute("SELECT id, RowName, OrgForm, inn, kpp FROM sp_kontr ORDER BY id")
    items = []
    for row in cur.fetchall():
        d = row_to_dict(cur, row)
        items.append(
            {
                "id": int(d["id"]) if d["id"] is not None else None,
                "name": d.get("RowName"),
                "orgForm": d.get("OrgForm"),
                "inn": d.get("inn"),
                "kpp": d.get("kpp"),
            }
        )
    return {"version": "1.0", "source": str(MDB.name), "total": len(items), "items": items}


def export_agg(cur) -> dict:
    per = {}
    try:
        cur.execute("SELECT ZID, RowName FROM a_tblPERs")
        for row in cur.fetchall():
            d = row_to_dict(cur, row)
            per[str(d["ZID"]).strip()] = d.get("RowName")
    except Exception:
        pass

    cur.execute('SELECT ZID_AG, ZID_P, [Include?] FROM a_tblAgg_List ORDER BY ZID_AG, ZID_P')
    entries = []
    for row in cur.fetchall():
        d = row_to_dict(cur, row)
        parent = str(d["ZID_AG"]).strip()
        child = str(d["ZID_P"]).strip()
        entries.append(
            {
                "parentCode": parent,
                "childCode": child,
                "included": bool(d.get("Include?")),
                "parentName": per.get(parent),
                "childName": per.get(child),
            }
        )
    return {
        "version": "1.0",
        "source": str(MDB.name),
        "total": len(entries),
        "entries": entries,
    }


def export_form_correspondence(cur) -> dict:
    cur.execute(
        "SELECT Tname, GosForm, str, npp, Yellow, Red, Blue, Green, "
        "YellowCorr, RedCorr, BlueCorr, Dostup "
        "FROM FormCorrespondence ORDER BY npp"
    )
    forms = []
    for row in cur.fetchall():
        d = row_to_dict(cur, row)
        forms.append(
            {
                "formId": d["Tname"],
                "gosForm": d.get("GosForm"),
                "pages": int(d["str"]) if d.get("str") is not None else None,
                "order": float(d["npp"]) if d.get("npp") is not None else None,
                "saldoYellow": d.get("Yellow"),
                "saldoRed": d.get("Red"),
                "saldoBlue": d.get("Blue"),
                "saldoGreen": d.get("Green"),
                "saldoYellowCorr": d.get("YellowCorr"),
                "saldoRedCorr": d.get("RedCorr"),
                "saldoBlueCorr": d.get("BlueCorr"),
                "access": d.get("Dostup"),
            }
        )
    return {
        "version": "1.0",
        "source": str(MDB.name),
        "total": len(forms),
        "forms": forms,
    }


def main():
    if not MDB.exists():
        raise SystemExit(f"MDB not found: {MDB}")

    OUT.mkdir(parents=True, exist_ok=True)
    conn = connect()
    cur = conn.cursor()

    exports = [
        ("checks.json", export_checks),
        ("excel-export.json", export_excel),
        ("saldo-rules.json", export_saldo),
        ("form-correspondence.json", export_form_correspondence),
        ("row-formulas.json", export_row_formulas),
        ("recalc-rules.json", export_recalc_rules),
        ("kontr.json", export_kontr),
        ("rash-rules.json", export_rash),
        ("agg-list.json", export_agg),
    ]

    for filename, fn in exports:
        data = fn(cur)
        path = OUT / filename
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"  {filename}: {data.get('total', '?')} records")

    conn.close()
    print(f"\nExported to {OUT}")


if __name__ == "__main__":
    main()
