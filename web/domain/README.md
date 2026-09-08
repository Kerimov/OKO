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

1. Создаёт таблицы.
2. Импортирует шаблоны и правила из `web/portal/public/`.
3. Создаёт admin из `OKO_BOOTSTRAP_ADMIN_*`.

---

## Структура `src/`

| Файл | Назначение |
|------|------------|
| `legacy-routes.ts` | Middleware shell для Nest (CORS, auth, audit) |
| `instance-submit.ts` | Сдача формы + серверные period-проверки |
| `db.ts` | Bootstrap БД |
| `oko-db.ts` | PostgreSQL |
| `auth.ts` | Логин, сессии, Bearer |
| `instances.ts` | CRUD экземпляров |
| `forms.ts` / `checks.ts` / `saldo.ts` / … | Домены метаданных |
| `packages.ts` | Организации, периоды, комплекты |
| `orgScope.ts` | Ограничение по ZID |

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
