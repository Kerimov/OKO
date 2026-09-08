# OKO API — доменный слой

Бизнес-логика и доступ к БД для REST API. **HTTP-entrypoint — NestJS** ([`../api`](../api)).

---

## Запуск API (Nest)

```bash
# из корня
./dev.sh

# или
cd ../api && npm install && npm run dev   # :3001, Swagger /api/docs
```

Переменные окружения — [`.env.example`](../.env.example). Требуется **`DATABASE_URL`** (PostgreSQL).

---

## База данных

| Режим | Переменная | Файл схемы |
|-------|------------|------------|
| **PostgreSQL** | `DATABASE_URL=postgresql://...` | `data/schema.postgresql.sql` |

Офлайн-комплекты десктопа (`desktop/`, файл `oko.db`) — отдельный SQLite WAL; не используется API.

Абстракция: `src/oko-db.ts` (`OkoDb`, только Postgres).

При старте Nest вызывается `bootstrapDatabase()`:

1. Numbered migrations `src/migrations/00x_*.ts` — единственный источник изменений схемы (`schema_migrations`). Миграция `015` поглощает прежний boot DDL из `migrate*Tables()`.
2. `migratePackageExchange()` — разовый data-transform legacy PK → GUID (не DDL).
3. Сиды справочников/шаблонов из `web/portal/public/` (если таблицы пустые).
4. Bootstrap admin из `OKO_BOOTSTRAP_ADMIN_*` (только пустая БД).

**Правило для новых изменений:** только numbered migration + обновление `data/schema.postgresql.sql`. Не добавляйте `ALTER TABLE` в устаревшие `migrate*Tables()`.

---

## Структура `src/`

| Файл | Назначение |
|------|------------|
| `legacy-routes.ts` | Middleware shell для Nest (CORS, auth, audit) |
| `instance-submit.ts` | Сдача формы + серверные period-проверки |
| `db.ts` | Bootstrap БД |
| `migrations/` | Numbered schema migrations |
| `oko-db.ts` | PostgreSQL |
| `auth.ts` | Логин, сессии, Bearer |
| `instances.ts` | CRUD экземпляров |
| `forms.ts` / `checks.ts` / `saldo.ts` / … | Домены метаданных |
| `packages.ts` | Barrel для package-модулей |
| `packageTypes.ts` | Контракты, статусы и package identifiers |
| `packageOrganizations.ts` | Организации, периоды, work context |
| `packageWorkspace.ts` | Списки/детали комплектов и completeness |
| `packageOps.ts` | Создание, удаление, импорт/экспорт и конструирование комплектов |
| `orgScope.ts` | Ограничение по ZID |
| `minfinExport.ts` | Экспорт МинФин (зависимость `exceljs` в этом пакете) |

Общий движок увязок: [`@oko/engine`](../packages/engine).

---

## Эндпоинты

Контракты REST реализует Nest (`web/api/src/**`). Документация: `/api/docs`.

---

## Docker

`deploy/Dockerfile.api-nest` (`docker compose up`).

---

## См. также

- [api/README.md](../api/README.md)
- [archive/docs/DEVELOPMENT.md](../../archive/docs/DEVELOPMENT.md)
- [archive/docs/DEPLOY.md](../../archive/docs/DEPLOY.md)
