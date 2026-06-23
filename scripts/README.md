# Скрипты выгрузки данных из MDB

Python-утилиты для переноса метаданных из базы **ПК «ОКО»** (`z261.mdb`) в JSON-файлы портала.

Исходный MDB кладётся в `reference/` (не коммитится в git). Пароль: `12345`.

---

## Основные скрипты (production)

| Скрипт | Назначение | Результат |
|--------|------------|-----------|
| **`generate_schemas_from_mdb.py`** | Шаблоны 76 форм: строки, колонки, метаданные | `portal/public/schemas/*.json`, `catalog.json` |
| **`export_mdb_data.py`** | Правила увязок, сальдо, Excel, расшифровки, агрегация | `portal/public/data/*.json` |
| **`build-offline-kit.sh`** | ZIP offline-портала для дочки (JSON-комплект на входе) | `dist/oko-offline-kit.zip` |

Запуск из корня репозитория:

```bash
python scripts/generate_schemas_from_mdb.py
python scripts/export_mdb_data.py
```

После выгрузки — Reimport в API (`/admin/forms`, `/admin/checks` и т.д.) или пересоздание БД.

---

## Вспомогательные скрипты (разработка / анализ)

| Скрипт | Назначение |
|--------|------------|
| `explore_mdb.py`, `explore_mdb2.py`, `explore_mdb3.py` | Исследование структуры таблиц MDB |
| `explore_phase2.py` | Анализ таблиц для Phase 2 |
| `explore_exports.py` | Проверка выгруженных JSON |
| `explore_excel.py` | Анализ Excel-маппинга |
| `compare_forms.py`, `compare_forms_detail.py` | Сверка форм MDB ↔ портал |
| `check_n02_6.py` | Точечная проверка формы N02_6 |
| `check_encoding.py` | Кодировки в MDB |
| `missing_forms_info.py` | Какие формы отсутствуют в каталоге |
| `mde_gap.py` | Разрыв между MDE и порталом |
| `empty_portal_forms.py` | Генерация пустых экземпляров |
| `generate_schemas.py` | Устаревший генератор (используйте `generate_schemas_from_mdb.py`) |

---

## Зависимости

Скрипты используют стандартную библиотеку Python и/или:

- доступ к `reference/z261.mdb` через ODBC или mdbtools (зависит от скрипта);
- пути относительно корня репозитория.

Перед первым запуском убедитесь, что MDB на месте:

```bash
ls reference/z261.mdb   # файл должен существовать локально
```

---

## Workflow обновления комплекта ОКО

```
Новый z261.mdb от методологов
        ↓
reference/z261.mdb
        ↓
generate_schemas_from_mdb.py  →  portal/public/schemas/
export_mdb_data.py            →  portal/public/data/
        ↓
git commit JSON-файлов
        ↓
Reimport в production API
```

---

## См. также

- [reference/README.md](../reference/README.md)
- [reference/docs/oko-analysis.md](../reference/docs/oko-analysis.md)
- [docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md)
