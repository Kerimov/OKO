#!/usr/bin/env python3
"""Generate JSON form schemas from OKO legacy MDB (z261.mdb).

Source of truth: a_stblROWs, a_stblFIELDs, FormCorrespondence in z261.mdb.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pyodbc

ROOT = Path(__file__).resolve().parent.parent
MDB = ROOT / "reference" / "z261.mdb"
if not MDB.exists():
    MDB = ROOT / "12345" / "z261.mdb"
MDE = ROOT / "reference" / "OKO26-1.mde"
if not MDE.exists():
    MDE = ROOT / "12345" / "OKO26-1.mde"
OUT_DIR = ROOT / "portal" / "public" / "schemas"

SKIP_FIELDS = {"ZID", "EID", "Sort"}
SYSTEM_FIELDS = {"Number", "Name"}

CATEGORIES = {
    "N01": "Бухгалтерская отчётность",
    "N02": "Основные средства и НМА",
    "N03": "Сегментная отчётность",
    "N04": "Финансовые вложения",
    "N05": "Запасы",
    "N06": "Дебиторская задолженность",
    "N09": "Кредиторская задолженность",
    "N10": "Заёмные средства",
    "N11": "Выручка",
    "N12": "Затраты и себестоимость",
    "N13": "Прочие доходы и расходы",
    "N14": "Движение денежных средств (детализация)",
    "N15": "Расчёты с бюджетом",
    "N16": "Валютные активы и задолженность",
    "N19": "Акции",
    "ND": "Дополнительные формы",
}

# Fallback titles (UTF-8); overridden by tblExcelExport when available.
FORM_TITLES: dict[str, str] = {
    "N01_01": "Остатки по счетам (входящие)",
    "N01_02": "Остатки по счетам (исходящие)",
    "N01_1": "Бухгалтерский баланс",
    "N01_11": "Справка о забалансовых счетах",
    "N01_111": "Расшифровка бухгалтерского баланса",
    "N01_12": "Бух. баланс по видам деятельности на начало отчетного периода",
    "N01_13": "Бух. баланс по видам деятельности на конец отчетного периода",
    "N01_2": "Отчет о финансовых результатах",
    "N01_22": "Расчет текущего налога на прибыль",
    "N01_23": "Временные разницы и отложенные налоговые активы и обязательства",
    "N01_30": "Отчет об изменениях капитала (предыдущий год)",
    "N01_31": "Отчет об изменениях капитала (отчетный период)",
    "N01_34": "Доля меньшинства",
    "N01_4": "Отчет о движении денежных средств",
    "N01_511": "Наличие и движение нематериальных активов в отчетном периоде",
    "N01_513": "Наличие и движение НМА в отчетном периоде, созданных организацией",
    "N01_54": "Справка к отчёту о финансовых результатах",
    "N02_1": "Основные средства",
    "N02_2": "Амортизация и обесценение основных средств",
    "N02_3": "Материальные и нематериальные поисковые активы",
    "N02_4": "Инвестиционная недвижимость в отчетном периоде",
    "N02_6": "Стоимость, амортизация и обесценение прав пользования активами",
    "N03_1": "Сегмент",
    "N03_2": "Объекты с минимальными объемами капвложений",
    "N04_1": "Инвестиции в дочерние и зависимые организации",
    "N04_2": "Резерв под обесценение по инвестициям",
    "N04_3": "Долгосрочные долговые финансовые вложения",
    "N04_4": "Долгосрочные и краткосрочные займы",
    "N04_5": "Краткосрочные финансовые вложения",
    "N04_6": "Приобретенные права требования",
    "N04_7": "Резерв под обесценение по долговым финансовым вложениям",
    "N05_1": "Готовая продукция, товары, материалы",
    "N05_11": "Резерв под обесценение запасов",
    "N05_2": "Товары отгруженные (счет 45)",
    "N05_3": "Расходы будущих периодов (счет 97)",
    "N06_7": "Чистые инвестиции в аренду (Сч. 7657)",
    "N06_11": "Задолженность покупателей продукции, товаров, работ, услуг",
    "N06_111": "Движение резерва по сомнительным долгам (покупатели)",
    "N06_112": "Движение резерва по сомнительным долгам (авансы)",
    "N06_113": "Движение резерва по сомнительным долгам (прочая)",
    "N06_12": "Движение стоимости авансов выданных",
    "N06_13": "Движение стоимости прочей дебиторской задолженности",
    "N06_41": "Внешняя дебиторская задолженность по срокам погашения",
    "N09_1": "Движение кредиторской задолженности перед поставщиками",
    "N09_2": "Движение векселей к уплате",
    "N09_3": "Движение прочей кредиторской задолженности",
    "N09_31": "График погашения кредиторской задолженности",
    "N09_32": "Движение кредиторской задолженности по авансам полученным",
    "N09_4": "Доходы будущих периодов",
    "N09_5": "Оценочные обязательства",
    "N09_6": "Обязательства по аренде (Сч. 7656)",
    "N10_1": "Кредиты и займы полученные",
    "N10_2": "Задолженность по основным видам, валютам и ставкам",
    "N10_3": "Долгосрочные внешние кредиты и займы по срокам погашения",
    "N10_4": "Краткосрочные внешние кредиты и займы",
    "N11_3": "Продажи по видам деятельности (счет 90)",
    "N12_1": "Затраты (сч.20,21,23,25,26,29,44)",
    "N12_2": "Затраты по элементам",
    "N12_3": "Себестоимость продаж по видам деятельности (по статьям)",
    "N12_4": "Себестоимость продаж по видам деятельности",
    "N12_5": "Себестоимость продаж по видам деятельности (по элементам)",
    "N13_1": "Прочие доходы и расходы",
    "N13_2": "Налог на прибыль и иные обязательные платежи из прибыли",
    "N14_1": "Движение денежных средств",
    "N14_11": "Движение денежных средств (расшифровка, стр. 2)",
    "N14_12": "Движение денежных средств (расшифровка, стр. 3)",
    "N15_1": "Расчеты с бюджетом по налогам и страховым взносам",
    "N15_11": "Реструктурированные налоги по сроку погашения",
    "N16_2": "Активы по видам валют на конец отчетного периода",
    "N16_3": "Внешняя задолженность",
    "N16_4": "Просроченная задолженность",
    "N19_1": "Движение обыкновенных акций ПАО «Газпром»",
    "ND2": "ОС на балансе, поступившие от компаний Группы",
    "ND3": "Внутригрупповая реализация основных средств",
    "ND4": "Долгосрочная дебиторская задолженность (справедливая стоимость)",
    "ND7": "Дополнительная форма ND7",
}


def connect():
    return pyodbc.connect(
        rf"DRIVER={{Microsoft Access Driver (*.mdb, *.accdb)}};"
        rf"DBQ={MDB};PWD=12345;"
    )


def category_for(form_id: str) -> str:
    if form_id.startswith("ND"):
        return "ND"
    return form_id.split("_")[0]


def clean_label(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", str(text).replace("\r\n", " ").replace("\r", " ")).strip()


def format_row_no(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value == int(value):
        return str(int(value))
    return str(value).strip()


def load_form_registry(cur) -> list[tuple[str, float | None]]:
    cur.execute("SELECT Tname, str FROM FormCorrespondence ORDER BY npp")
    return [(row.Tname, row.str) for row in cur.fetchall()]


def load_excel_titles(cur) -> dict[str, str]:
    cur.execute(
        "SELECT FormName, MIN(ExcelSheetName) AS title "
        "FROM tblExcelExport GROUP BY FormName"
    )
    return {
        row.FormName: clean_label(row.title)
        for row in cur.fetchall()
        if row.title
    }


def load_fields(cur, form_id: str) -> list:
    cur.execute(
        "SELECT Pos, FName, Ftype, FWidth, FCaption "
        "FROM a_stblFIELDs WHERE TName=? ORDER BY Pos",
        form_id,
    )
    return cur.fetchall()


def load_rows(cur, form_id: str) -> list:
    cur.execute(
        "SELECT RowNo, RowNoOLD, RowName, kod "
        "FROM a_stblROWs WHERE TName=? ORDER BY Sort",
        form_id,
    )
    return cur.fetchall()


def mde_page_count(form_id: str) -> int:
    if not MDE.exists():
        return 1
    text = MDE.read_bytes().decode("latin-1", errors="ignore")
    subforms = len(re.findall(rf"frm_{re.escape(form_id)}[A-Za-z]", text, re.I))
    return max(1, 1 + subforms)


def detect_allow_add_rows(fields) -> bool:
    for f in fields:
        if f.FName == "Name" and f.FCaption:
            cap = clean_label(f.FCaption).lower()
            if "контраг" in cap or "организац" in cap:
                return True
    return False


def col_width(fname: str, ftype: int, fwidth) -> int:
    if fname == "num":
        return 55
    if fname == "name":
        return 320
    if fwidth and int(fwidth) > 0:
        return max(90, min(280, int(fwidth) * 8))
    return 110 if ftype == 4 else 100


def build_columns(fields, allow_add: bool) -> list[dict]:
    name_caption = "Наименование показателя"
    for f in fields:
        if f.FName == "Name" and f.FCaption:
            name_caption = clean_label(f.FCaption)
            break

    columns: list[dict] = [
        {
            "key": "num",
            "label": "№",
            "type": "text",
            "width": 55,
            "frozen": True,
            "readonly": True,
        },
        {
            "key": "name",
            "label": name_caption,
            "type": "text",
            "width": 320,
            "frozen": True,
            "readonly": not allow_add,
        },
    ]

    for f in fields:
        if f.FName in SYSTEM_FIELDS or f.FName in SKIP_FIELDS:
            continue
        col_type = "number" if f.Ftype == 4 else "text"
        label = clean_label(f.FCaption) or f.FName
        columns.append(
            {
                "key": f.FName,
                "label": label,
                "type": col_type,
                "width": col_width(f.FName, f.Ftype, f.FWidth),
            }
        )
    return columns


def build_row_templates(rows) -> list[dict]:
    templates: list[dict] = []
    for row in rows:
        num = format_row_no(row.RowNo)
        name = clean_label(row.RowName)
        if not name:
            if row.RowNoOLD:
                old = clean_label(row.RowNoOLD)
                name = f"({old})" if old else "—"
            elif num:
                name = f"Строка {num}"
            else:
                name = "—"
        item: dict = {"name": name}
        if num:
            item["num"] = num
        code = clean_label(row.kod) if row.kod else ""
        if code:
            item["code"] = code
        elif row.RowNoOLD:
            old = clean_label(row.RowNoOLD)
            if old and old != num:
                item["code"] = old
        templates.append(item)
    return templates


def resolve_title(form_id: str, excel_titles: dict[str, str]) -> str:
    if form_id in FORM_TITLES:
        return FORM_TITLES[form_id]
    excel = excel_titles.get(form_id, "")
    if excel and len(excel) > 5 and not re.fullmatch(r"[\d\.]+", excel):
        return excel
    return form_id


def build_schema(cur, form_id: str, excel_titles: dict[str, str], pages_hint) -> dict:
    fields = load_fields(cur, form_id)
    rows = load_rows(cur, form_id)
    allow_add = detect_allow_add_rows(fields)
    title = resolve_title(form_id, excel_titles)
    pages = mde_page_count(form_id)
    if pages_hint and pages_hint > pages:
        pages = int(pages_hint)

    return {
        "id": form_id,
        "title": title,
        "category": category_for(form_id),
        "pages": pages,
        "pdfFile": f"1@1_{form_id}.pdf",
        "meta": {
            "organization": "",
            "enterpriseCode": "1@1",
            "periodStart": "",
            "periodEnd": "",
            "unit": "тыс.руб.",
        },
        "columns": build_columns(fields, allow_add),
        "rows": build_row_templates(rows),
        "allowAddRows": allow_add,
        "signatures": ["Руководитель", "Главный бухгалтер"],
    }


def build_catalog(schemas: list[dict]) -> dict:
    used_categories = sorted({s["category"] for s in schemas})
    categories = {k: v for k, v in CATEGORIES.items() if k in used_categories}
    return {
        "version": "2.0",
        "name": "ОКО — Портал форм корпоративной отчётности",
        "description": "Схемы форм, сгенерированы из z261.mdb (a_stblROWs, a_stblFIELDs, FormCorrespondence)",
        "source": "12345/z261.mdb",
        "categories": categories,
        "forms": [
            {
                "id": s["id"],
                "title": s["title"],
                "category": s["category"],
                "pages": s["pages"],
                "pdfFile": s["pdfFile"],
            }
            for s in schemas
        ],
    }


def main():
    if not MDB.exists():
        raise SystemExit(f"MDB not found: {MDB}")

    conn = connect()
    cur = conn.cursor()
    registry = load_form_registry(cur)
    excel_titles = load_excel_titles(cur)

    schemas: list[dict] = []
    for form_id, pages_hint in registry:
        schema = build_schema(cur, form_id, excel_titles, pages_hint)
        schemas.append(schema)
        out_path = OUT_DIR / f"{form_id}.json"
        out_path.write_text(
            json.dumps(schema, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"  {form_id}: {len(schema['rows'])} rows, {len(schema['columns'])-2} data cols")

    conn.close()

    catalog = build_catalog(schemas)
    (OUT_DIR / "catalog.json").write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    # Remove schemas not in registry
    valid_ids = {s["id"] for s in schemas}
    for path in OUT_DIR.glob("*.json"):
        if path.name == "catalog.json":
            continue
        if path.stem not in valid_ids:
            path.unlink()
            print(f"  removed obsolete: {path.name}")

    print(f"\nGenerated {len(schemas)} forms -> {OUT_DIR}")


if __name__ == "__main__":
    main()
