# Соглашения по разработке

Правила для участников проекта OKO. Цель — единообразный код и понятная история изменений при аудите.

---

## Ветки и коммиты

- Основная ветка: `main`.
- Коммиты — на **английском**, кратко и по делу:
  - `Add user edit panel on admin Users page`
  - `Fix PostgreSQL date errors when period fields are empty`
- Один коммит — одна логическая задача.
- Не коммитить: `.env`, `*.mdb`, `*.mde`, `data/oko.db`, `portal/public/pdf/*.pdf`, папку `12345/`.

---

## Структура кода

### Фронтенд (`portal/src/`)

- **pages/** — страницы; один React-компонент на файл, имя = `*Page.tsx`.
- **components/** — переиспользуемые части UI без привязки к маршруту.
- **engine/** — чистая логика без React (проверки, пересчёт, экспорт).
- **content/** — только markdown для инструкции.

Новый экран: файл в `pages/` + маршрут в `App.tsx` + пункт в `Layout.tsx` (если нужен в меню).

### Бэкенд (`server/src/`)

- Один домен — один файл (`checks.ts`, `users.ts`).
- Регистрация маршрутов — в `index.ts`.
- SQL через `OkoDb` (`oko-db.ts`), не напрямую к драйверу.

### Схема БД

При изменении таблиц обновляйте **оба** файла:

- `data/schema.sql` (SQLite)
- `data/schema.postgresql.sql` (PostgreSQL)

---

## Документация

| Что изменили | Куда обновить |
|--------------|---------------|
| Новый раздел UI | `portal/src/content/instructions-*.md` + `docs/PORTAL-GUIDE.md` |
| Новый API-эндпоинт | `server/README.md` |
| Архитектурное решение | `docs/ARCHITECTURE.md` |
| Завершённый этап | `CHANGELOG.md`, при необходимости `PHASE*-PLAN.md` |

---

## Стиль кода

- TypeScript, строгая типизация.
- Минимальный diff — не рефакторить попутно.
- Комментарии — только для неочевидной бизнес-логики.
- Следовать существующим паттернам файла, в который вносите правки.

---

## Pull Request (если используется)

1. Описание: что сделано и зачем.
2. Test plan: как проверить вручную.
3. Скриншоты — для заметных UI-изменений.

---

## Обновление из MDB

При получении нового комплекта ОКО от методологов:

```bash
# 1. Положить z261.mdb в reference/
python scripts/generate_schemas_from_mdb.py
python scripts/export_mdb_data.py
# 2. Reimport в /admin/forms, /admin/checks и т.д.
# 3. Зафиксировать в CHANGELOG
```
