# Local Postgres for OKO API

## Рекомендуемый путь (Docker)

На macOS CLI Docker Desktop часто не в PATH — используйте полный путь или добавьте:

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
```

Если на хосте уже слушает **PostgreSQL 18** (`/Library/PostgreSQL/18`) на `:5432`, поднимите compose на другом порту:

```bash
cd /path/to/OKO
# в .env:
# POSTGRES_PORT=5433
# DATABASE_URL=postgresql://oko:oko@localhost:5433/oko
# DATABASE_SSL=false

docker compose up -d postgres
# проверка: docker compose exec postgres pg_isready -U oko -d oko
```

`./dev.sh` подхватит `DATABASE_URL` из `.env` (через `server/src/env.ts`).

## Нативный PostgreSQL без Docker

Создайте роль/БД `oko` в установке `/Library/PostgreSQL/18` и пропишите свой `DATABASE_URL` в `.env`. Пароль суперпользователя задаётся при установке EDB.
