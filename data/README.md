# Схемы базы данных OKO

| Файл | СУБД | Использование |
|------|------|---------------|
| `schema.postgresql.sql` | PostgreSQL 16 | **API** (Nest) — source of truth |
| `schema.sql` | SQLite | Справка / исторический шаблон; десктоп-кит создаёт `oko.db` в Tauri (DDL в Rust) |

Применяется автоматически при `bootstrapDatabase()` в `web/domain/src/db.ts` (только PostgreSQL).

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
form_template_rows     (form_id, …)
form_instances         (instance_id, template_id, zid, eid, …)
form_cell_values       (instance_id, row_no, column_key, …)
```

Остальные домены (checks, saldo, rash, audit, users) — в `schema.postgresql.sql`.

---

## См. также

- [archive/docs/ARCHITECTURE.md](../archive/docs/ARCHITECTURE.md)
- [archive/docs/DEVELOPMENT.md](../archive/docs/DEVELOPMENT.md)
- [LOCAL-POSTGRES.md](../archive/docs/LOCAL-POSTGRES.md)
