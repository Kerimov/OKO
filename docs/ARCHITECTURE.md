# Архитектура OKO

Описание технической архитектуры веб-портала корпоративной отчётности.

---

## Общая схема

```
┌─────────────────────────────────────────────────────────────┐
│  Браузер пользователя                                       │
│  portal/ — React SPA (Vite)                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │ pages/      │  │ engine/      │  │ storage.ts          │ │
│  │ UI экраны   │  │ бизнес-логика│  │ API ↔ localStorage  │ │
│  └─────────────┘  └──────────────┘  └─────────────────────┘ │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS  /api/*
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  server/ — Express API (TypeScript)                         │
│  auth · instances · forms · checks · packages · users     │
└───────────────────────────┬─────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
     PostgreSQL (prod)              SQLite (dev)
     data/schema.postgresql.sql     data/schema.sql
```

**Принцип:** портал может работать автономно (localStorage + JSON в `public/`), но в production всегда подключён к API.

---

## Фронтенд (`portal/`)

### Стек

- **React 19** + **TypeScript**
- **Vite** — сборка и dev-сервер
- **React Router** — маршрутизация SPA
- **react-markdown** — страница инструкции

### Структура `portal/src/`

| Каталог | Назначение |
|---------|------------|
| `pages/` | Страницы-маршруты (один файл ≈ один экран) |
| `components/` | Переиспользуемые UI-компоненты |
| `engine/` | Движки бизнес-логики (проверки, пересчёт, сальдо, агрегация) |
| `content/` | Markdown-инструкции для `/instructions` |
| `api.ts`, `apiClient.ts` | HTTP-клиент к API |
| `storage.ts` | Абстракция хранения: API или localStorage |
| `auth.ts`, `useAuth.ts` | Сессия, роли |
| `types.ts` | Общие TypeScript-типы |

### Маршруты

| Путь | Страница | Роль |
|------|----------|------|
| `/` | Вход | все |
| `/catalog` | Каталог шаблонов | все |
| `/my` | Мои формы | все |
| `/my/:instanceId` | Редактор формы | все |
| `/package` | Комплект (ZID/EID) | все |
| `/tools` | Сводка и импорт | admin |
| `/admin/*` | Редакторы, пользователи, аудит | admin |
| `/settings` | Настройки | все |
| `/instructions` | Инструкция | все |

Маршруты защищены `AuthGate` и `AdminAccessGate`.

### Движки (`engine/`)

Логика, портированная из Access VBA и SQL-запросов:

| Модуль | Назначение |
|--------|------------|
| `checkEngine.ts` | Проверка увязок (a_tblchecks) |
| `recalcEngine.ts` | Пересчёт итоговых строк (FTotal) |
| `saldoEngine.ts` | Перенос сальдо |
| `aggregateEngine.ts` | Суммирование экземпляров |
| `rashEngine.ts` | Проверка расшифровок |
| `exportExcel.ts` | Выгрузка в Excel |
| `packageExport.ts` | Экспорт комплекта JSON |

Движки работают **на клиенте** с данными, загруженными через API. Это сознательное решение Phase 2: не дублировать логику на сервере, сохранить отзывчивость UI.

### Данные в `portal/public/`

| Путь | Содержание |
|------|------------|
| `schemas/*.json` | 76 шаблонов форм (строки, колонки) |
| `schemas/catalog.json` | Индекс каталога |
| `data/checks.json` | Правила увязок (fallback) |
| `data/saldo-rules.json` | Правила сальдо |
| `data/recalc-rules.json` | Правила пересчёта |
| `pdf/*.pdf` | Образцы бланков (локально, не в git) |

---

## Бэкенд (`server/`)

### Стек

- **Express 4** + **TypeScript**
- **pg** — PostgreSQL (production)
- **node:sqlite** — SQLite (development, experimental API Node 22)

### Абстракция БД

`server/src/oko-db.ts` — единый интерфейс `OkoDb` для SQLite и PostgreSQL.  
Выбор по переменной `DATABASE_URL`.

### Модули API

| Файл | Ответственность |
|------|-----------------|
| `index.ts` | Маршруты, сборка приложения |
| `auth.ts` | Логин, сессии, Bearer-токены, роли |
| `instances.ts` | CRUD экземпляров форм |
| `forms.ts` | Шаблоны, строки, колонки |
| `checks.ts` | Правила увязок |
| `saldo.ts` | Правила сальдо, FormCorrespondence |
| `excel.ts` | Маппинг Excel |
| `rash.ts` | Расшифровки |
| `aggregation.ts` | Связи parent/child org |
| `packages.ts` | Организации, периоды, рабочий контекст |
| `users.ts` | Учётные записи |
| `audit.ts` | Журнал изменений метаданных |
| `orgScope.ts` | Фильтрация по ZID для роли org |

### Инициализация БД

`server/src/db.ts` → `bootstrapDatabase()`:

1. Применяет `schema.sql` или `schema.postgresql.sql`.
2. Импортирует шаблоны и правила из JSON (если таблицы пусты).
3. Создаёт bootstrap-admin при `OKO_BOOTSTRAP_ADMIN_*`.

---

## База данных (`data/`)

Основные сущности:

```
organizations (ZID) ──┬── periods (EID)
                      │
form_templates ───────┼── form_instances (данные отчётности)
                      │
check_rules, saldo_rules, excel_mappings, agg_list, users, audit_log
```

Подробнее: [data/README.md](../data/README.md).

---

## Авторизация

```
Запрос → authMiddleware
           ├─ Bearer token → role: admin | user
           └─ Session cookie → user: { role, zid, ... }
                └─ orgScope → фильтр WHERE zid = user.zid
```

- **admin** — полный доступ, `requireAdmin` на `/admin/*`.
- **org** — `assertOrgInstanceAccess`, `enforceOrgInstanceWrite`.

---

## Деплой

| Среда | Портал | API | БД |
|-------|--------|-----|-----|
| Dev | `vite` :5173 | `tsx` :3001 | SQLite `data/oko.db` |
| Prod | Vercel CDN | Render Docker | PostgreSQL managed |

Переменная `VITE_API_URL` в сборке портала указывает на production API.

---

## Поток данных: заполнение формы

```
1. Пользователь открывает /my/:id
2. storage.ts → GET /api/instances/:id
3. FormTable рендерит ячейки из schema + values
4. Редактирование → PUT /api/instances/:id
5. «Проверить форму» → checkEngine (клиент) + snapshot всех форм периода
6. «Сдать» → PATCH status=submitted
```

---

## Зависимость от исходного Access

Схемы и правила **генерируются** из `z261.mdb` скриптами в `scripts/`.  
При обновлении комплекта ОКО от методологов:

1. Положить новый MDB в `reference/`.
2. Запустить `generate_schemas_from_mdb.py`, `export_mdb_data.py`.
3. Reimport в API через UI или пересоздание БД.
