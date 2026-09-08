# Соглашения по разработке

Правила для участников проекта OKO. Цель — единообразный код и понятная история изменений при аудите.

---

## Ветки и коммиты

- Основная ветка: `main`.
- Коммиты — на **английском**, кратко и по делу:
  - `Add user edit panel on admin Users page`
  - `Fix PostgreSQL date errors when period fields are empty`
- Один коммит — одна логическая задача.
- Не коммитить: `.env`, `*.mdb`, `*.mde`, `data/oko.db`, `web/portal/public/pdf/*.pdf`, папку `archive/kits/12345/`.

---

## Структура кода

### Фронтенд (`web/portal/src/`)

- **pages/** — страницы; один React-компонент на файл, имя = `*Page.tsx`.
- **components/** — переиспользуемые части UI без привязки к маршруту.
- **engine/** — чистая логика без React (проверки, пересчёт, экспорт).
- **content/** — только markdown для инструкции.

Новый экран: файл в `pages/` + маршрут в `App.tsx` + пункт в `Layout.tsx` (если нужен в меню).

### API (`web/api/src/`) и домен (`web/domain/src/`)

- Nest-контроллеры и DTO — в `web/api/src/**`.
- Доменная логика — в `web/domain/src/*.ts` (один домен — один файл или модуль).
- SQL через `OkoDb` (`oko-db.ts`); контроллеры не пишут SQL напрямую.
- Новые изменения схемы — numbered migrations в `web/domain/src/migrations/`.

### Схема БД

При изменении таблиц обновляйте:

- `data/schema.postgresql.sql` (API / PostgreSQL)
- `data/schema.sql` (справочная схема для desktop kit / SQLite)
- numbered migration в `web/domain/src/migrations/`

---

## Документация

| Что изменили | Куда обновить |
|--------------|---------------|
| Новый раздел UI | **пока не обновлять** инструкцию (`instructions-*.md`, `PORTAL-GUIDE.md`) — рано |
| Новый API-эндпоинт | `web/api/README.md` / `web/domain/README.md` |
| Архитектурное решение | `archive/docs/ARCHITECTURE.md` |
| Завершённый этап | `CHANGELOG.md`, при необходимости `PHASE*-PLAN.md` |

Инструкция в портале и `PORTAL-GUIDE.md` заморожены: не дополнять при обычных доработках, только по явной просьбе.

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
