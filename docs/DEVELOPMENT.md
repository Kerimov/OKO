# Руководство разработчика

Локальная среда, типичные задачи и отладка.

---

## Требования

| Инструмент | Версия |
|------------|--------|
| Node.js | 22+ (SQLite через `--experimental-sqlite`) |
| npm | 10+ |
| Python | 3.10+ (только для скриптов MDB) |
| Git | — |

Опционально: Docker, PostgreSQL 16 (для проверки prod-схемы).

---

## Первый запуск

```bash
git clone https://github.com/Kerimov/OKO.git
cd OKO

# API
cd server
npm install
cp ../.env.example ../.env   # при необходимости
npm run dev
# → http://localhost:3001/api/health

# Портал (новый терминал)
cd portal
npm install
npm run dev
# → http://localhost:5173
```

Vite проксирует `/api` на `localhost:3001` (см. `portal/vite.config.ts`).

### Первый вход

При пустой БД и заданных в `.env`:

```env
OKO_BOOTSTRAP_ADMIN_USER=admin
OKO_BOOTSTRAP_ADMIN_PASSWORD=admin123
```

Войдите на http://localhost:5173/ под этими учётными данными.

---

## Структура работы

```
portal/src/pages/     — добавляйте новые экраны здесь + маршрут в App.tsx
portal/src/engine/    — бизнес-логика без UI
server/src/           — новые API-эндпоинты + регистрация в index.ts
data/                 — изменения схемы БД (оба файла: sqlite + postgresql)
```

### Соглашения

- TypeScript strict, ES modules (`"type": "module"`).
- Имена файлов: `PascalCase` для React-компонентов, `camelCase` для утилит.
- API-модули — один домен на файл (`checks.ts`, `instances.ts`).
- Коммиты на английском, повелительное наклонение: `Add …`, `Fix …`.

Подробнее: [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## Режимы работы портала

| Режим | Условие | Хранение |
|-------|---------|----------|
| **Backend** | API доступен, `isBackendMode()` = true | PostgreSQL / SQLite через API |
| **Offline** | API недоступен | localStorage + JSON из `public/` |

Проверка: в UI отображается `POSTGRESQL` или `SQLITE` в углу.

---

## PostgreSQL локально

```bash
docker compose --profile postgres up -d
export DATABASE_URL=postgresql://oko:oko@localhost:5432/oko
cd server && npm run dev
```

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

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DEPLOY.md](DEPLOY.md)
- [portal/README.md](../portal/README.md)
- [server/README.md](../server/README.md)
