# Деплой OKO (Phase 2.5)

## Архитектура

| Компонент | Где хостить | Примечание |
|-----------|-------------|------------|
| **Портал** (`portal/`) | Vercel, Netlify, nginx | Статика, Root Directory: `portal` |
| **API** (`server/`) | Render, Railway, Docker | PostgreSQL (prod) или SQLite (dev) |

Портал на Vercel **не** запускает API. Нужен отдельный хост с `docker compose` или `npm start` в `server/`.

---

## PostgreSQL (production, Render / Railway)

Данные **не пропадают** при redeploy — БД живёт отдельно от контейнера API.

1. На Render: **New → PostgreSQL**, создайте базу (например `oko`).
2. В **Web Service** (API): **Connect → Link Resource** к этой PostgreSQL.
3. Render подставит `DATABASE_URL` автоматически.
4. Persistent Disk для SQLite **не нужен** — можно отключить.
5. Переменные API:
   - `DATABASE_URL` — из linked PostgreSQL
   - `OKO_BOOTSTRAP_ADMIN_USER` / `OKO_BOOTSTRAP_ADMIN_PASSWORD`
6. При первом старте API применит `data/schema.postgresql.sql` и засеет шаблоны из JSON.

Проверка:

```bash
curl -s https://your-api.onrender.com/api/health
# {"ok":true,"db":"postgresql",...}
```

Локально с PostgreSQL:

```bash
docker compose --profile postgres up -d
export DATABASE_URL=postgresql://oko:oko@localhost:5432/oko
cd server && npm run dev
```

---

## SQLite (локально / Docker без Postgres)

```bash
docker compose up -d --build
```

Данные SQLite: volume `oko-data` → `/app/data/oko.db`. **На Render без volume данные теряются при каждом deploy** — для prod используйте PostgreSQL.

---

## Роли и авторизация

### Вариант 1 — Bearer-токены (legacy / сервисные аккаунты)

| Переменная | Роль | Доступ |
|------------|------|--------|
| `OKO_ADMIN_TOKEN` | **admin** | Всё: редакторы метаданных, импорт, аудит |
| `OKO_USER_TOKEN` | **user** | Заполнение форм, настройки, «Мои формы»; без `/admin/*` |

Заголовок запроса:

```http
Authorization: Bearer <token>
```

В портале (если нет учётных записей): **Настройки → API-токен** (`sessionStorage`).

### Вариант 2 — Учётные записи (личные кабинеты организаций)

При первом запуске с пустой БД создаётся admin, если заданы:

```env
OKO_BOOTSTRAP_ADMIN_USER=admin
OKO_BOOTSTRAP_ADMIN_PASSWORD=your-secure-password
```

- Вход в портале: **`/login`** (логин/пароль, сессия 7 дней)
- Админ создаёт пользователей организаций: **`/admin/users`** (привязка к `zid`)
- Пользователь `org` видит только данные своей организации (фильтр по `zid` на API)
- LDAP — запланирован на отдельный этап

Режимы можно комбинировать (`authMode: mixed`): сессии + legacy-токены.

### Режим разработки

Если **нет** `OKO_ADMIN_TOKEN` и **нет** пользователей в БД — авторизация отключена, все запросы как admin.

---

## Портал + удалённый API

1. Задеплойте API (Docker), получите URL, например `https://oko-api.example.com`.
2. При сборке портала:

```bash
cd portal
VITE_API_URL=https://oko-api.example.com npm run build
```

3. На Vercel: Environment Variable `VITE_API_URL` = URL API.
4. CORS на API уже включён (`cors()`). При необходимости ограничьте origin в `server/src/index.ts`.

Локально без `VITE_API_URL` прокси Vite направляет `/api` → `localhost:3001`.

---

## Журнал аудита

Таблица `report_log` — изменения метаданных (увязки, формы, сальдо, Excel).

- API: `GET /api/audit?limit=50&offset=0&q=` (только **admin**)
- UI: `/admin/audit`

---

## Railway / VPS без Docker

```bash
# Node 22+
cd server && npm ci && npm start
```

Переменные: `DATABASE_URL` (PostgreSQL) **или** `OKO_DB_PATH` (SQLite), `OKO_BOOTSTRAP_ADMIN_*`, `PORT`.

---

## Проверка после деплоя

```bash
curl -s http://localhost:3001/api/health | jq
curl -s -H "Authorization: Bearer $OKO_ADMIN_TOKEN" http://localhost:3001/api/auth/me | jq
```

В браузере: бейдж **PostgreSQL** / **SQLite** + роль в настройках; редакторы `/admin/*` видны только admin.
