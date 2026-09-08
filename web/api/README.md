# OKO API (NestJS)

Целевой REST API. Доменная логика остаётся в [`../domain/src`](../domain/src); контроллеры Nest — в `src/`.

Swagger: http://localhost:3001/api/docs

---

## Запуск

```bash
# из корня репозитория (рекомендуется)
./dev.sh

# только API
cd web/api
npm install
npm run dev      # :3001
```

Доменная зависимость: пакет `web/domain/` + `@oko/engine` (`packages/engine`).

Переменные окружения — [`.env.example`](../.env.example). Требуется `DATABASE_URL` (PostgreSQL).

---

## Структура

| Путь | Назначение |
|------|------------|
| `src/main.ts` | Bootstrap: Express shell + Nest adapter |
| `src/app.module.ts` | Модули API |
| `src/*/…controller.ts` | HTTP-слой |
| `../domain/src/*` | Домен (БД, правила, instances, auth) |
| `../domain/src/legacy-routes.ts` | CORS, JSON, auth/audit middleware |
| `../packages/engine` | `@oko/engine` — общие проверки |

---

## Docker

```bash
docker compose up -d --build          # deploy/Dockerfile.api-nest
# prod on-prem:
./scripts/prod-up.sh                  # docker-compose.prod.yml
```

---

## См. также

- [domain/README.md](../domain/README.md) — доменный слой
- [archive/docs/DEVELOPMENT.md](../../archive/docs/DEVELOPMENT.md)
- [archive/docs/DEPLOY.md](../../archive/docs/DEPLOY.md)
