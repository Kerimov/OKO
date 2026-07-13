# Руководство разработчика

Локальная среда, типичные задачи и отладка.

---

## Требования

| Инструмент | Версия |
|------------|--------|
| Node.js | 22+ |
| npm | 10+ |
| Python | 3.10+ (только для скриптов MDB) |
| Git | — |
| Docker / PostgreSQL 16 | обязателен для API |

---

## Первый запуск

```bash
git clone https://github.com/Kerimov/OKO.git
cd OKO

cp .env.example .env   # DATABASE_URL → Postgres; OKO_AUTH_DISABLED=1

# Postgres (если ещё не запущен)
docker compose up -d postgres

# API (NestJS) + портал — ./dev.sh сам поднимет postgres при отсутствии DATABASE_URL
./dev.sh
# → API http://localhost:3001/api/health
# → Swagger http://localhost:3001/api/docs
# → Portal http://localhost:5173
```

Вручную:

```bash
export DATABASE_URL=postgresql://oko:oko@localhost:5432/oko
cd server-nest && npm install && npm run dev
cd portal && npm install && npm run dev
```

Vite проксирует `/api` на `localhost:3001` (см. `portal/vite.config.ts`).

### Первый вход

По умолчанию в `.env` задано `OKO_AUTH_DISABLED=1` — API работает без токена и пароля.

Если авторизация включена (`OKO_AUTH_DISABLED` убран или `0`, либо задан `OKO_ADMIN_TOKEN`):

```env
OKO_BOOTSTRAP_ADMIN_USER=admin
OKO_BOOTSTRAP_ADMIN_PASSWORD=admin123
```

Войдите на http://localhost:5173/ под этими учётными данными.

---

## Структура работы

```
portal/src/pages/     — экраны + маршрут в App.tsx
portal/src/engine/    — UI-обёртки; ядро увязок в packages/engine (@oko/engine)
server-nest/src/      — Nest-контроллеры / модули
server/src/           — домен (БД, проверки, instances) — без новых Express-роутов
packages/engine/      — общий движок увязок
data/                 — схема БД (postgresql; schema.sql — справка)
```

### Соглашения

- TypeScript strict, ES modules (`"type": "module"`).
- Имена файлов: `PascalCase` для React-компонентов, `camelCase` для утилит.
- API: HTTP в `server-nest`, домен в `server/src/*.ts`.
- Коммиты на английском, повелительное наклонение: `Add …`, `Fix …`.

Подробнее: [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## Режимы работы портала

| Режим | Условие | Хранение |
|-------|---------|----------|
| **Backend** | API доступен, `isBackendMode()` = true | PostgreSQL через Nest |
| **Локальный** | API недоступен | localStorage + JSON из `public/` |

---

## PostgreSQL локально

```bash
docker compose up -d postgres
export DATABASE_URL=postgresql://oko:oko@localhost:5432/oko
cd server-nest && npm run dev
```

API требует PostgreSQL. Offline desktop kits используют файл `oko.db` в папке комплекта (Tauri).

Подробнее без Docker: [LOCAL-POSTGRES.md](LOCAL-POSTGRES.md).

---

## Обновление данных из MDB

1. Скопируйте `z261.mdb` в `reference/` (пароль: `12345`).
2. Установите зависимости Python: `pip install mdbtools` или используйте встроенные скрипты.
3. Запустите:

```bash
python scripts/generate_schemas_from_mdb.py
python scripts/export_mdb_data.py
```

4. Перезапустите API или нажмите **Reimport** в редакторах `/admin/*`.

---

## Сборка production

```bash
# Портал
cd portal
VITE_API_URL=https://your-api.onrender.com npm run build
# артефакт: portal/dist/

# API
docker compose up -d --build
```

### Десктоп Tauri (пилот)

```bash
cd desktop/tauri
npm ci
npm run build:tauri          # установщик текущей ОС
# macOS: npm run build:tauri:dmg
# Windows: npm run build:tauri:nsis
```

Нагрузка 10 клиентов на одном `oko.db`:

```bash
python3 scripts/tauri-collab-smoke.py /path/to/package --clients 10 --seconds 20
```

Подробнее: [DESKTOP-TAURI-PILOT.md](DESKTOP-TAURI-PILOT.md).

---

## Отладка

| Проблема | Решение |
|----------|---------|
| 401 на API | Проверьте сессию / токен в Настройках |
| org не видит формы | Проверьте `zid` в `users` и `form_instances` |
| Проверки не работают | `GET /api/checks/export` — есть ли правила в БД |
| Даты в PostgreSQL | `dbValues.ts` — `dateOrNull()` для пустых строк |

Логи API: stdout контейнера / терминала `npm run dev`.

---

## Тестирование

Автотесты пока не настроены. Ручная проверка:

1. Завести комплект → открыть N01_1 → сохранить → проверить.
2. Войти под org-пользователем → убедиться в изоляции ZID.
3. `curl /api/health`, `curl /api/checks/stats`.

---

## Полезные ссылки

- [DESKTOP-TAURI-PILOT.md](DESKTOP-TAURI-PILOT.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DEPLOY.md](DEPLOY.md)
- [portal/README.md](../portal/README.md)
- [server-nest/README.md](../server-nest/README.md)
- [server/README.md](../server/README.md)
