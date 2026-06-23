# OKO API Server

REST API для веб-портала корпоративной отчётности. Хранит экземпляры форм, метаданные шаблонов, правила увязок и учётные записи.

---

## Запуск

```bash
npm install
npm run dev      # разработка, порт 3001
npm start        # production
```

Переменные окружения — см. [`.env.example`](../.env.example).

---

## База данных

| Режим | Переменная | Файл схемы |
|-------|------------|------------|
| SQLite (dev) | `OKO_DB_PATH=./data/oko.db` | `data/schema.sql` |
| PostgreSQL (prod) | `DATABASE_URL=postgresql://...` | `data/schema.postgresql.sql` |

Абстракция: `src/oko-db.ts` — класс `OkoDb` с единым интерфейсом для обоих движков.

При первом запуске `bootstrapDatabase()`:

1. Создаёт таблицы.
2. Импортирует шаблоны и правила из `portal/public/`.
3. Создаёт admin-пользователя из `OKO_BOOTSTRAP_ADMIN_*`.

---

## Структура `src/`

| Файл | Назначение |
|------|------------|
| `index.ts` | Точка входа, регистрация маршрутов |
| `db.ts` | Инициализация и bootstrap |
| `oko-db.ts` | Абстракция SQLite / PostgreSQL |
| `auth.ts` | Логин, сессии, Bearer-токены |
| `instances.ts` | CRUD экземпляров форм |
| `forms.ts` | Шаблоны, строки, колонки |
| `checks.ts` | Правила увязок |
| `saldo.ts` | Сальдо, FormCorrespondence |
| `excel.ts` | Маппинг Excel |
| `rash.ts` | Расшифровки |
| `aggregation.ts` | Связи агрегации |
| `packages.ts` | Организации, периоды, контекст |
| `users.ts` | Учётные записи |
| `audit.ts` | Журнал аудита |
| `orgScope.ts` | Ограничение доступа org по ZID |
| `paths.ts` | Пути к корню репозитория |
| `dbValues.ts` | Нормализация значений для БД |

---

## Основные эндпоинты

### Публичные

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/health` | Статус, тип БД |
| POST | `/api/auth/login` | Вход по логину/паролю |
| POST | `/api/auth/logout` | Выход |

### Экземпляры форм

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/instances` | Список (фильтр по ZID для org) |
| GET | `/api/instances/:id` | Одна форма |
| POST | `/api/instances` | Создать |
| PUT | `/api/instances/:id` | Сохранить данные |
| PATCH | `/api/instances/:id` | Статус (сдать / черновик) |
| DELETE | `/api/instances/:id` | Удалить |

### Комплекты

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/organizations` | Список org |
| POST | `/api/organizations` | Создать org |
| GET | `/api/periods` | Периоды по ZID |
| POST | `/api/periods` | Создать период |
| GET/PUT | `/api/work-context` | Текущий ZID/EID |
| POST | `/api/packages/seed` | Завести 76 форм |

### Метаданные (admin)

| Префикс | Описание |
|---------|----------|
| `/api/forms` | Шаблоны |
| `/api/checks` | Увязки |
| `/api/saldo` | Сальдо |
| `/api/excel` | Excel-маппинг |
| `/api/rash` | Расшифровки |
| `/api/aggregation` | Агрегация |
| `/api/users` | Пользователи |
| `/api/audit` | Журнал |

Полный список — в `src/index.ts`.

---

## Авторизация

1. **Сессия** — cookie после `POST /api/auth/login`.
2. **Bearer** — заголовок `Authorization: Bearer <OKO_ADMIN_TOKEN|OKO_USER_TOKEN>`.

Middleware: `authMiddleware` → `requireAdmin` (для `/admin` API) → `orgScope` (фильтр ZID).

---

## Docker

```bash
# из корня репозитория
docker compose up -d --build
```

Образ собирается из корневого `Dockerfile`, копирует `server/` и `portal/public/`.

---

## См. также

- [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
- [docs/DEPLOY.md](../docs/DEPLOY.md)
- [data/README.md](../data/README.md)
