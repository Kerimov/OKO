# OKO API — доменный слой

Бизнес-логика и доступ к БД для REST API. **HTTP-entrypoint — NestJS** ([`../server-nest`](../server-nest)).

---

## Запуск API (Nest)

```bash
# из корня
./dev.sh

# или
cd ../server-nest && npm install && npm run dev   # :3001, Swagger /api/docs
```

Переменные окружения — [`.env.example`](../.env.example).

### Legacy Express

`src/index.ts` больше **не** регистрирует REST-маршруты (только CORS/auth/audit shell).  
Escape hatch: `OKO_API_RUNTIME=express ./dev.sh`.

---

## База данных

| Режим | Переменная | Файл схемы |
|-------|------------|------------|
| **PostgreSQL (SoT)** | `DATABASE_URL=postgresql://...` | `data/schema.postgresql.sql` |
| SQLite (opt-in API / desktop kits) | без `DATABASE_URL` + `OKO_ALLOW_SQLITE=1` / `OKO_DB_PATH` | `data/schema.sql` |

Абстракция: `src/oko-db.ts` — `OkoDb` для обоих движков. В production без `DATABASE_URL` API не стартует (нужен Postgres).

При старте Nest вызывается `bootstrapDatabase()`:

1. Создаёт таблицы.
2. Импортирует шаблоны и правила из `portal/public/`.
3. Создаёт admin из `OKO_BOOTSTRAP_ADMIN_*`.

---

## Структура `src/`

| Файл | Назначение |
|------|------------|
| `index.ts` | **Deprecated** Express entrypoint (shell only) |
| `legacy-routes.ts` | Middleware shell для Nest |
| `instance-submit.ts` | Сдача формы + серверные period-проверки |
| `db.ts` | Bootstrap БД |
| `oko-db.ts` | SQLite / PostgreSQL |
| `auth.ts` | Логин, сессии, Bearer |
| `instances.ts` | CRUD экземпляров |
| `forms.ts` / `checks.ts` / `saldo.ts` / … | Домены метаданных |
| `packages.ts` | Организации, периоды, комплекты |
| `orgScope.ts` | Ограничение по ZID |

Общий движок увязок: [`@oko/engine`](../packages/engine).

---

## Эндпоинты

Контракты REST реализует Nest (`server-nest/src/**`). Документация: `/api/docs`.

| Метод | Путь (пример) | Примечание |
|-------|---------------|------------|
| GET | `/api/health` | Публичный |
| PATCH | `/api/instances/:id/status` | `submitted` → периодные проверки на сервере |
| … | `/api/forms`, `/api/checks`, … | См. Swagger |

---

## Docker

По умолчанию: `deploy/Dockerfile.api-nest` (`docker compose up`).

---

## См. также

- [server-nest/README.md](../server-nest/README.md)
- [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
- [docs/DEPLOY.md](../docs/DEPLOY.md)
