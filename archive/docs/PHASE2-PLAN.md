# План Phase 2: метаданные ОКО (аналог таблиц z261.mdb)

Цель: перейти от статических JSON к **редактируемой БД**, как в MS Access (`a_tblchecks`, `a_stblROWs`, `a_stblFIELDs`).

## Принцип

| Было (Phase 1) | Станет (Phase 2+) |
|----------------|-------------------|
| `public/data/checks.json` | таблица `check_rules` + API |
| `public/schemas/*.json` | таблицы `form_templates`, `form_rows`, `form_columns` + API |
| `saldo-rules.json`, `form-correspondence.json` | `saldo_rules`, `form_templates` |
| Vercel = только фронт | Prod: VPS + API + PostgreSQL/SQLite |

Портал: **API → fallback на JSON** (офлайн / Vercel без бэкенда).

---

## Этап 2.1 — Редактор увязок ✅

| Задача | Статус |
|--------|--------|
| `check_rules` в SQLite + API | ✅ |
| UI `/admin/checks` | ✅ |

## Этап 2.2 — Конструктор форм ✅ (MVP)

| Задача | Статус |
|--------|--------|
| `form_templates`, `form_template_columns`, `form_template_rows` | ✅ |
| Импорт из JSON-схем при первом запуске API | ✅ |
| REST: catalog, schema, save, reimport | ✅ |
| `loadCatalog()` / `loadSchema()` → API + fallback | ✅ |
| UI `/admin/forms` — графы, строки, превью | ✅ |

**API:**

- `GET /api/checks` — `?q=&formId=&active=&periodActive=&limit=&offset=`
- `GET /api/checks/stats`
- `GET /api/checks/export` — полный дамп для движка проверок
- `GET /api/checks/:number`
- `PUT /api/checks/:number`
- `POST /api/checks`
- `DELETE /api/checks/:number`
- `POST /api/checks/reimport` — перезагрузка из JSON

---

## Этап 2.2 — Конструктор форм (строки и графы)

**Аналог Access:** `a_stblROWs`, `a_stblFIELDs`, `FormCorrespondence`.

| Задача | Оценка |
|--------|--------|
| Таблицы `form_rows`, `form_columns`, доработка `form_templates` | 3 дн |
| Импорт из MDB / текущих JSON-схем | 2 дн |
| API CRUD для строк и граф | 4 дн |
| UI `/admin/forms` — выбор формы, сетка строк/колонок | 1 нед |
| Превью формы (рендер `FormTable` из БД) | 2 дн |
| `loadSchema()` → API с fallback на JSON | 1 дн |

**Не в MVP конструктора:** `sp_rash`, сложные `FTotal`, все 126 frm_* из MDE.

---

## Этап 2.3 — Сальдо и Excel-маппинг ✅ (MVP)

| Задача | Статус |
|--------|--------|
| `saldo_rules` + FormCorrespondence в БД | ✅ |
| Импорт из JSON при первом запуске API | ✅ |
| REST: saldo CRUD, correspondence, excel CRUD | ✅ |
| `loadSaldoRules()` / `loadFormCorrespondence()` / `loadExcelExport()` → API + fallback | ✅ |
| UI `/admin/saldo` — правила + FormCorrespondence | ✅ |
| UI `/admin/excel` — маппинг tblExcelExport | ✅ |

**API (сальдо):**

- `GET /api/saldo/export` — дамп для движка переноса
- `GET /api/saldo/stats`, `GET /api/saldo` — список с фильтрами
- `GET/PUT/DELETE /api/saldo/:number`, `POST /api/saldo`, `POST /api/saldo/reimport`
- `GET /api/correspondence/export`, `GET/PUT /api/correspondence/:formId`, `POST /api/correspondence/reimport`

**API (Excel):**

- `GET /api/excel/export`, `GET /api/excel/stats`, `GET /api/excel`
- `GET/PUT/DELETE /api/excel/:id`, `POST /api/excel`, `POST /api/excel/reimport`

---

## Этап 2.3 — Сальдо и Excel-маппинг (детали)

| Задача | Оценка |
|--------|--------|
| `saldo_rules` + `form_correspondence` в БД | 3 дн |
| UI редактирования правил сальdo | 1 нед |
| `excel_mappings` в БД + UI | 1 нед |

---

## Этап 2.4 — Нормализация данных форм ✅ (MVP)

**Было:** `portal_instances.payload` — JSON blob.

| Задача | Статус |
|--------|--------|
| `form_instances` + `form_cell_values` | ✅ |
| Сохранение/загрузка через ячейки | ✅ |
| Миграция payload → ячейки при старте API | ✅ |
| `GET /api/instances/eval-snapshot` — ускорение проверок | ✅ |
| Двойная запись payload (совместимость) | ✅ |

**API:**

- `GET /api/instances/stats` — счётчики экземпляров и ячеек
- `POST /api/instances/normalize` — ручная миграция из payload
- `GET /api/instances/eval-snapshot` — снимок для движка увязок без полной десериализации JSON

---

## Этап 2.4 — Нормализация данных форм (детали)

**Сейчас:** `portal_instances.payload` — JSON blob.

| Задача | Оценка |
|--------|--------|
| `form_cell_values` (instance_id, row_no, column_key, value) | 1 нед |
| Миграция payload → ячейки | 3 дн |
| Ускорение проверок и агрегации | 2 дн |

---

## Этап 2.5 — Prod и роли ✅ (MVP)

| Задача | Статус |
|--------|--------|
| Docker + docker-compose | ✅ |
| Токены admin / user (`OKO_ADMIN_TOKEN`, `OKO_USER_TOKEN`) | ✅ |
| Журнал `report_log` + `/admin/audit` | ✅ |
| `VITE_API_URL` для портала на Vercel | ✅ |
| Документация [docs/DEPLOY.md](DEPLOY.md) | ✅ |

PostgreSQL — опционально, не в MVP.

---

## Этап 2.5 — Prod и роли (детали)

| Задача | Оценка |
|--------|--------|
| Деплой API (Docker, VPS / Railway) | 2 дн |
| PostgreSQL вместо SQLite (опционально) | 3 дн |
| Роли: admin (метаданные) / user (заполнение) | 1 нед |
| `report_log` — журнал изменений правил и форм | 3 дн |

---

## Порядок реализации (рекомендуемый)

```
2.1 Увязки     → 2.2 Конструктор форм → 2.3 Сальдо/Excel
       ↓
2.4 Ячейки в БД (параллельно после 2.1)
       ↓
2.5 Prod + роли
```

---

## Критерии готовности Phase 2.1

- [ ] Методолог может изменить увязку без правки JSON и без Python
- [ ] Проверка в «Администрировании» использует правила из БД
- [ ] Изменения сохраняются после перезапуска API
- [ ] На Vercel без API — прежнее поведение (статический `checks.json`)

---

*Обновлено: июнь 2026*
