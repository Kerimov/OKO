# OKO — веб-портал корпоративной отчётности

Веб-замена программного комплекса **ПК «ОКО»** (MS Access): заполнение **76 форм** корпоративной отчётности, проверка увязок, сдача комплектов, агрегация по группе организаций.

| Среда | Портал | API |
|-------|--------|-----|
| Production | [Vercel](https://vercel.com) — статика из `web/portal/` | NestJS (`web/api` + домен `web/domain`), PostgreSQL |
| Локально | http://localhost:5173 | http://localhost:3001 · Swagger `/api/docs` |

---

## Для аудита и новых участников

| Документ | Содержание |
|----------|------------|
| [**archive/docs/AUDIT-OVERVIEW.md**](archive/docs/AUDIT-OVERVIEW.md) | Что сделано, зачем, этапы миграции с Access, принятые решения |
| [**archive/docs/ARCHITECTURE.md**](archive/docs/ARCHITECTURE.md) | Архитектура: фронт, API, БД, движки, авторизация |
| [**archive/docs/PORTAL-GUIDE.md**](archive/docs/PORTAL-GUIDE.md) | Инструкция пользователя и администратора |
| [**CHANGELOG.md**](archive/docs/CHANGELOG.md) | История изменений по коммитам |
| [**archive/docs/README.md**](archive/docs/README.md) | Полный указатель документации |

---

## Быстрый старт (разработка)

Требуется **Node.js 22+**.

```bash
./start.sh
```

Скрипт сам создаст `.env` (если нет), поднимет Postgres в Docker, API и портал, откроет браузер.  
Остановка: `Ctrl+C` или `./start.sh --stop`. Фон: `./start.sh --detach`.

Портал: http://localhost:5173 · Swagger: http://localhost:3001/api/docs.

Подробнее: [**archive/docs/DEVELOPMENT.md**](archive/docs/DEVELOPMENT.md).

---

## Структура репозитория

```
OKO/
├── web/portal/     # React-приложение (Vite + TypeScript)
├── web/api/        # NestJS REST API
├── web/domain/     # Доменный слой (БД, правила) для Nest
├── desktop/        # Десктоп «ОКО Заполнение» (Tauri 2 + SQLite kit)
├── packages/engine/ # @oko/engine — общие проверки увязок
├── data/            # SQL-схемы (PostgreSQL API; schema.sql — справка для kit)
├── scripts/         # CI/ops: journey, corpus, smoke, prod helpers
├── archive/docs/    # Документация проекта (архив)
├── archive/reference/ # Исходный комплект ПК «ОКО» (MDB локально, не в git)
├── docker-compose.yml
└── deploy/Dockerfile.api-nest
```

| Каталог | Назначение | README |
|---------|------------|--------|
| `web/portal/` | UI: каталог, редактор форм, админка, инструкции | [web/portal/README.md](web/portal/README.md) |
| `web/api/` | NestJS HTTP API, Swagger | [web/api/README.md](web/api/README.md) |
| `web/domain/` | Домен: auth, instances, checks, … | [web/domain/README.md](web/domain/README.md) |
| `packages/engine/` | `@oko/engine` | — |
| `desktop/` | Десктоп (Tauri 2) | [desktop/README.md](desktop/README.md) |
| `data/` | Схемы таблиц | [data/README.md](data/README.md) |
| `scripts/` | CI/ops utilities | [scripts/README.md](scripts/README.md) |
| `archive/reference/` | Эталонный комплект Access для сверки | [archive/reference/README.md](archive/reference/README.md) |
| `archive/docs/` | Развёртывание, планы фаз, архитектура | [archive/docs/README.md](archive/docs/README.md) |

---

## Основные возможности

**Пользователь организации:** вход по логину, выбор периода, заведение комплекта (76 форм), заполнение, проверка увязок, сдача, PDF/Excel.

**Администратор (ЦО):** организации и периоды, пакетная проверка и пересчёт, перенос сальдо, агрегация, редакторы правил (увязки, сальдо, Excel, расшифровки), учётные записи, журнал аудита.

---

## Деплой

```bash
cp .env.example .env   # DATABASE_URL, OKO_BOOTSTRAP_ADMIN_*
docker compose up -d --build   # API + SQLite volume
```

Портал на Vercel: Root Directory = `web/portal`, переменная `VITE_API_URL` → URL API.

Полная инструкция: [**archive/docs/DEPLOY.md**](archive/docs/DEPLOY.md).

---

## Исходная система

Логика и структура данных воспроизводят **ПК «ОКО»** (Access `OKO26-1.mde` + `z261.mdb`). Анализ исходника: [archive/reference/docs/oko-analysis.md](archive/reference/docs/oko-analysis.md).

Планы развития: [Phase 2](archive/docs/PHASE2-PLAN.md) · [Phase 3](archive/docs/PHASE3-PLAN.md).

---

## Лицензия и контакты

Внутренний проект группы. Исходные материалы ПК «ОКО» — собственность правообладателя комплекса.
