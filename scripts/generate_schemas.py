#!/usr/bin/env python3
"""DEPRECATED: use generate_schemas_from_mdb.py instead.

Legacy PDF parser. Source of truth for schemas is z261.mdb (see generate_schemas_from_mdb.py).
"""
import json
import re
from pathlib import Path

import fitz

PDF_DIR = Path("/Users/vadim/Desktop/Формы ОКО/ОКО-pdf")
OUT_DIR = Path(__file__).resolve().parent.parent / "portal" / "public" / "schemas"

FORM_TITLES = {
    "N01_01": "Остатки по счетам (входящие)",
    "N01_02": "Остатки по счетам (исходящие)",
    "N01_1": "Бухгалтерский баланс",
    "N01_11": "Справка о забалансовых счетах",
    "N01_12": "Бух. баланс по видам деятельности на начало отчетного периода",
    "N01_13": "Бух. баланс по видам деятельности на конец отчетного периода",
    "N01_2": "Отчет о финансовых результатах",
    "N01_22": "Расчет текущего налога на прибыль",
    "N01_23": "Временные разницы и отложенные налоговые активы и обязательства",
    "N01_30": "Отчет об изменениях капитала (предыдущий год)",
    "N01_31": "Отчет об изменениях капитала (отчетный период)",
    "N01_32": "Корректировки в связи с изменением учетной политики и исправлением ошибок",
    "N01_33": "Чистые активы",
    "N01_34": "Доля меньшинства",
    "N01_4": "Отчет о движении денежных средств",
    "N01_511": "Наличие и движение нематериальных активов в отчетном периоде",
    "N01_513": "Наличие и движение НМА в отчетном периоде, созданных организацией",
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
    "N15_1": "Расчеты с бюджетом по налогам и страховым взносам",
    "N15_11": "Реструктурированные налоги по сроку погашения",
    "N16_2": "Активы по видам валют на конец отчетного периода",
    "N16_3": "Внешняя задолженность",
    "N16_4": "Просроченная задолженность",
    "N19_1": "Движение обыкновенных акций ПАО «Газпром»",
    "ND1": "Котируемые долевые финансовые активы",
    "ND2": "ОС на балансе, поступившие от компаний Группы",
    "ND3": "Внутригрупповая реализация основных средств",
    "ND4": "Долгосрочная дебиторская задолженность (справедливая стоимость)",
    "ND5": "Внеоборотные активы, предназначенные для продажи",
}


def form_id_from_path(p: Path) -> str:
    return p.stem.replace("1@1_", "")


def extract_rows(text: str) -> list[dict]:
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    rows: list[dict] = []
    skip = re.compile(
        r"^(№|Стр\.|Руководитель|Гл\.|N\d|ND\d|Организация|Предприятие|Отч\.|"
        r"период:|Ед\.изм|Данные от|\d{2}\.\d{2}\.\d{4}|Год,|Предыдущий|Отчетный|"
        r"СПРАВОЧНО|Денежные|Анализ|ИТОГО ДЕБЕТ|ИТОГО КРЕДИТ|ОБЕСЦЕНЕНИЕ|"
        r"Материальные|Нематериальные|Результаты|Разрешения|Сч\.|в т\.ч\.)",
        re.I,
    )
    i = 0
    while i < len(lines):
        line = lines[i]
        if skip.match(line) or len(line) < 2:
            i += 1
            continue
        if re.match(r"^[A-ZА-Я]$", line) or line in ("Дебет", "Кредит", "Стр."):
            i += 1
            continue

        m = re.match(r"^(\d{1,4})\s+(.+)$", line)
        if m and not re.match(r"^\d{4}$", m.group(2)[:4] if len(m.group(2)) >= 4 else ""):
            rows.append({"num": m.group(1), "name": m.group(2)[:250]})
            i += 1
            continue

        m2 = re.match(r"^(\d{4})\s+(.+)$", line)
        if m2:
            rows.append({"code": m2.group(1), "name": m2.group(2)[:250]})
            i += 1
            continue

        if re.match(r"^\d{1,4}$", line) and i + 1 < len(lines):
            num = line
            nxt = lines[i + 1]
            if re.match(r"^[\d\s]+$", nxt) or re.match(r"^1\s+\d{3}", nxt):
                code = nxt.replace(" ", "")
                parts = []
                j = i + 2
                while j < len(lines):
                    nl = lines[j]
                    if re.match(r"^[\d\-\+]+$", nl) or re.match(r"^\d{1,4}$", nl):
                        break
                    if re.match(r"^[A-Z]$", nl) or skip.match(nl):
                        break
                    parts.append(nl)
                    j += 1
                    if len(parts) >= 4:
                        break
                name = " ".join(parts).strip()
                if name:
                    rows.append({"num": num, "code": code, "name": name[:250]})
                i = j
                continue

        i += 1

    seen: set[str] = set()
    unique: list[dict] = []
    for r in rows:
        key = f"{r.get('num','')}|{r.get('code','')}|{r.get('name','')[:40]}"
        if key not in seen:
            seen.add(key)
            unique.append(r)
    return unique


def columns_for_form(form_id: str, text: str) -> list[dict]:
    base_name = [
        {"key": "num", "label": "№", "type": "text", "width": 55, "frozen": True, "readonly": True},
        {
            "key": "name",
            "label": "Наименование показателя",
            "type": "text",
            "width": 320,
            "frozen": True,
            "readonly": True,
        },
    ]
    base_account = [
        {"key": "account", "label": "Счет", "type": "text", "width": 180, "frozen": True},
    ]

    if form_id in ("N01_01", "N01_02"):
        cols = base_account[:]
        for grp in ("B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"):
            cols.extend(
                [
                    {"key": f"{grp}_str", "label": f"Стр. {grp}", "type": "number", "width": 70},
                    {"key": f"{grp}_debit", "label": f"Дебет {grp}", "type": "number", "width": 90},
                    {"key": f"{grp}_credit", "label": f"Кредит {grp}", "type": "number", "width": 90},
                ]
            )
        cols.extend(
            [
                {"key": "Z_debit", "label": "Итого дебет Z", "type": "number", "width": 100},
                {"key": "total_credit", "label": "Итого кредит Б", "type": "number", "width": 100},
            ]
        )
        return cols

    if form_id == "N01_1":
        return base_name + [
            {"key": "B", "label": "Баланс 31.12 (год предш. предыд.)", "type": "number"},
            {"key": "C", "label": "Корректировки (год предш. предыд.)", "type": "number"},
            {"key": "G", "label": "Баланс после корр. (год предш. предыд.)", "type": "number"},
            {"key": "D", "label": "Баланс 31.12 (предыд. год)", "type": "number"},
            {"key": "E", "label": "Корректировки (предыд. год)", "type": "number"},
            {"key": "F", "label": "Баланс после корр. (предыд. год)", "type": "number"},
            {"key": "H", "label": "Баланс на конец (отч. период)", "type": "number"},
            {"key": "I", "label": "Изменения при агрегации", "type": "number"},
            {"key": "J", "label": "Баланс на конец отч. периода", "type": "number"},
        ]

    if form_id in ("N01_12", "N01_13"):
        activities = [
            ("B", "Добыча газа"),
            ("C", "Переработка"),
            ("D", "Транспортировка"),
            ("E", "Поставка газа"),
            ("F", "Прочее"),
            ("G", "Нераспределенные данные"),
            ("H", "ИТОГО"),
            ("I", "Добыча нефти и газового конденсата"),
            ("J", "—"),
            ("K", "Хранение газа"),
            ("L", "Теплоэнергетика"),
        ]
        return base_name + [{"key": k, "label": lbl, "type": "number"} for k, lbl in activities]

    if form_id in ("N01_2", "N01_4", "N11_3"):
        return base_name + [
            {"key": "B", "label": "За отчетный период", "type": "number"},
            {"key": "C", "label": "За аналогичный период предыдущего года", "type": "number"},
        ]

    if form_id == "N01_11":
        return base_name + [
            {"key": "B", "label": "На 31 декабря предыдущего года", "type": "number"},
            {"key": "C", "label": "На конец отчетного периода", "type": "number"},
            {"key": "D", "label": "в т.ч. остатки по опер. с комп. Группы", "type": "number"},
            {"key": "F", "label": "На 31 декабря года, предш. предыдущему", "type": "number"},
        ]

    if form_id == "N01_33":
        return [
            {"key": "code", "label": "Код строки", "type": "text", "width": 90, "readonly": True},
            {"key": "name", "label": "Наименование показателя", "type": "text", "width": 280, "readonly": True},
            {"key": "B", "label": "На конец отчетного периода", "type": "number"},
            {"key": "C", "label": "На 31 декабря предыдущего года", "type": "number"},
            {"key": "D", "label": "На 31 декабря года, предш. предыдущему", "type": "number"},
        ]

    if form_id == "N01_34":
        return [
            {"key": "num", "label": "№", "type": "text", "width": 50},
            {"key": "name", "label": "Контрагент", "type": "text", "width": 220},
            {"key": "C", "label": "Доля меньшинства на начало, %", "type": "number"},
            {"key": "D", "label": "Поступл.: изм. доли, %", "type": "number"},
            {"key": "E", "label": "Поступл.: уставный капитал", "type": "number"},
            {"key": "F", "label": "Поступл.: добавочный капитал", "type": "number"},
            {"key": "G", "label": "Поступл.: резервный капитал", "type": "number"},
            {"key": "H", "label": "Поступл.: нераспр. прибыль прошлых лет", "type": "number"},
            {"key": "I", "label": "Поступл.: прибыль/убыток отч. периода", "type": "number"},
            {"key": "K", "label": "ИТОГО поступление", "type": "number"},
            {"key": "L", "label": "Выбытие: изм. доли, %", "type": "number"},
            {"key": "T", "label": "На конец отчетного периода", "type": "number"},
            {"key": "U", "label": "Доля меньшинства на конец, %", "type": "number"},
        ]

    if form_id.startswith("N02_"):
        asset_cols = [
            ("B", "Земельные участки (0110)"),
            ("C", "Здания произв. (0120)"),
            ("D", "Здания непроизв."),
            ("E", "Скважины"),
            ("F", "Магистр. трубопроводы"),
            ("P", "Дороги"),
            ("G", "Прочие сооруж. произв."),
            ("H", "Прочие сооруж. непроизв."),
            ("I", "Компрессоры"),
            ("J", "Прочие машины"),
            ("K", "Транспорт"),
            ("L", "Инвентарь"),
            ("M", "Другие ОС произв."),
            ("N", "Другие ОС непроизв."),
            ("O", "Итого"),
        ]
        return base_name + [{"key": k, "label": lbl, "type": "number"} for k, lbl in asset_cols]

    letters = []
    for m in re.finditer(r"\n([B-Z])\n", text):
        if m.group(1) not in letters:
            letters.append(m.group(1))
    if len(letters) >= 2:
        return base_name + [{"key": L, "label": f"Графа {L}", "type": "number"} for L in letters[:16]]

    return base_name + [
        {"key": "B", "label": "Графа B", "type": "number"},
        {"key": "C", "label": "Графа C", "type": "number"},
        {"key": "D", "label": "Графа D", "type": "number"},
        {"key": "E", "label": "Графа E", "type": "number"},
    ]


def parse_pdf(pdf_path: Path) -> dict:
    form_id = form_id_from_path(pdf_path)
    doc = fitz.open(str(pdf_path))
    pages = len(doc)
    full_text = "\n".join(doc[i].get_text() for i in range(pages))
    doc.close()

    title = FORM_TITLES.get(form_id, form_id)
    for line in full_text.split("\n")[:8]:
        if form_id in line and len(line) > len(form_id) + 5:
            title = line.replace(form_id, "").strip() or title
            break

    rows = extract_rows(full_text)
    columns = columns_for_form(form_id, full_text)
    category = re.match(r"^(N\d+|ND\d*)", form_id)
    cat = category.group(1) if category else "OTHER"
    if cat.startswith("ND"):
        cat = "ND"

    return {
        "id": form_id,
        "title": title,
        "category": cat,
        "pages": pages,
        "pdfFile": pdf_path.name,
        "meta": {
            "organization": "",
            "enterpriseCode": "1@1",
            "periodStart": "",
            "periodEnd": "",
            "unit": "тыс.руб.",
        },
        "columns": columns,
        "rows": rows,
        "allowAddRows": form_id in ("N01_34", "N06_41", "N09_31", "N16_3")
        or len(rows) == 0,
        "signatures": ["Руководитель", "Главный бухгалтер"],
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    schemas = []
    for pdf in sorted(PDF_DIR.glob("1@1_*.pdf")):
        if "_OKO_" in pdf.name:
            continue
        schema = parse_pdf(pdf)
        (OUT_DIR / f"{schema['id']}.json").write_text(
            json.dumps(schema, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        schemas.append(schema)
        print(f"{schema['id']}: {len(schema['rows'])} rows, {len(schema['columns'])} cols")

    catalog = {
        "version": "1.0",
        "name": "ОКО — Портал форм корпоративной отчётности",
        "description": "Создание и заполнение форм корпоративной (специализированной) отчётности",
        "categories": {
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
        },
        "forms": [
            {
                "id": s["id"],
                "title": s["title"],
                "category": s["category"],
                "pages": s["pages"],
                "pdfFile": s.get("pdfFile", ""),
            }
            for s in schemas
        ],
    }
    (OUT_DIR / "catalog.json").write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\nTotal: {len(schemas)} forms")


if __name__ == "__main__":
    main()
