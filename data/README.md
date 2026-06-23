# Схемы базы данных OKO

SQL-описание структуры данных портала. Два варианта для разных СУБД.

| Файл | СУБД | Использование |
|------|------|---------------|
| `schema.sql` | SQLite | Локальная разработка, Docker без Postgres |
| `schema.postgresql.sql` | PostgreSQL 16 | Production (Render, Railway) |

Применяется автоматически при `bootstrapDatabase()` в `server/src/db.ts`.

---

## Основные таблицы

### Справочники организаций

```sql
organizations (zid, name, code, parent_zid)
periods       (eid, zid, name, period_start, period_end, quarter, year)
```

- **ZID** — идентификатор организации (аналог `a_tblZIDs` в Access).
- **EID** — идентификатор периода (аналог `a_tblPERs`).

### Шаблоны и экземпляры форм

```sql
form_templates         (form_id, title, category, …)
form_template_columns  (form_id, col_key, header, …)
form_template_rows     (form_id, row_key, label, …)
form_instances         (id, form_id, zid, eid, values_json, status, …)
```

- **Шаблон** — структура одной из 76 форм (из `portal/public/schemas/`).
- **Экземпляр** — заполненная копия шаблона для конкретной org и периода.

### Правила и метаданные

```sql
check_rules            -- увязки (a_tblchecks)
saldo_rules            -- перенос сальдо (a_tblsaldo)
form_correspondence    -- соответствия форм Yellow/Red
excel_mappings         -- выгрузка в Excel
rash_thresholds        -- пороги расшифровок
rash_rules             -- sp_rash
agg_list               -- агрегация parent/child ZID
```

### Пользователи и аудит

```sql
users      (id, login, password_hash, role, zid, active, …)
audit_log  (id, user_id, action, entity, details, created_at)
work_context (user_id, zid, eid)  -- текущий контекст в UI
```

---

## Соответствие Access → SQL

| Access (z261.mdb) | Таблица OKO |
|-------------------|-------------|
| a_tblZIDs | organizations |
| a_tblPERs | periods |
| a_stblFORMs + строки/графы | form_templates, form_template_rows/columns |
| Данные форм | form_instances.values_json |
| a_tblchecks | check_rules |
| a_tblsaldo | saldo_rules |
| a_tblAgg_List | agg_list |

Полный анализ — [reference/docs/oko-analysis.md](../reference/docs/oko-analysis.md).

---

## Миграции

Отдельной системы миграций (Flyway, Prisma) нет. Изменения схемы:

1. Правка обоих `schema.*.sql`.
2. Для dev — удалить `data/oko.db` и перезапустить API.
3. Для prod — выполнить ALTER вручную или пересоздать managed DB.

---

## См. также

- [server/README.md](../server/README.md)
- [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
