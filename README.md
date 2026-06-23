# OKO — веб-портал корпоративной отчётности

Веб-замена программного комплекса **ПК «ОКО»** (MS Access): заполнение **76 форм** корпоративной отчётности, проверка увязок, сдача комплектов, агрегация по группе организаций.

| Среда | Портал | API |
|-------|--------|-----|
| Production | [Vercel](https://vercel.com) — статика из `portal/` | [Render](https://render.com) — `server/`, PostgreSQL |
| Локально | http://localhost:5173 | http://localhost:3001 |

---

## Для аудита и новых участников

| Документ | Содержание |
|----------|------------|
| [**docs/AUDIT-OVERVIEW.md**](docs/AUDIT-OVERVIEW.md) | Что сделано, зачем, этапы миграции с Access, принятые решения |
| [**docs/ARCHITECTURE.md**](docs/ARCHITECTURE.md) | Архитектура: фронт, API, БД, движки, авторизация |
| [**docs/PORTAL-GUIDE.md**](docs/PORTAL-GUIDE.md) | Инструкция пользователя и администратора |
| [**CHANGELOG.md**](CHANGELOG.md) | История изменений по коммитам |
| [**docs/README.md**](docs/README.md) | Полный указатель документации |

---

## Быстрый старт (разработка)

Требуется **Node.js 22+**.

```bash
# 1. API (SQLite по умолчанию, порт 3001)
cd server && npm install && npm run dev

# 2. Портал (порт 5173, прокси /api → localhost:3001)
cd portal && npm install && npm run dev
```

Откройте http://localhost:5173. При первом запуске API создаёт БД и импортирует шаблоны из JSON.

Подробнее: [**docs/DEVELOPMENT.md**](docs/DEVELOPMENT.md).

---

## Структура репозитория

```
OKO/
├── portal/          # React-приложение (Vite + TypeScript)
├── server/          # Express API (TypeScript)
├── data/            # SQL-схемы БД (SQLite / PostgreSQL)
├── scripts/         # Python: выгрузка и генерация из MDB Access
├── docs/            # Документация проекта
├── reference/       # Исходный комплект ПК «ОКО» (MDB локально, не в git)
├── docker-compose.yml
└── Dockerfile       # Сборка API для production
```

| Каталог | Назначение | README |
|---------|------------|--------|
| `portal/` | UI: каталог, редактор форм, админка, инструкции | [portal/README.md](portal/README.md) |
| `server/` | REST API, авторизация, хранение экземпляров и метаданных | [server/README.md](server/README.md) |
| `data/` | Схемы таблиц | [data/README.md](data/README.md) |
| `scripts/` | Инструменты миграции данных из `z261.mdb` | [scripts/README.md](scripts/README.md) |
| `reference/` | Эталонный комплект Access для сверки | [reference/README.md](reference/README.md) |
| `docs/` | Развёртывание, планы фаз, архитектура | [docs/README.md](docs/README.md) |

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

Портал на Vercel: Root Directory = `portal`, переменная `VITE_API_URL` → URL API.

Полная инструкция: [**docs/DEPLOY.md**](docs/DEPLOY.md).

---

## Исходная система

Логика и структура данных воспроизводят **ПК «ОКО»** (Access `OKO26-1.mde` + `z261.mdb`). Анализ исходника: [reference/docs/oko-analysis.md](reference/docs/oko-analysis.md).

Планы развития: [Phase 2](docs/PHASE2-PLAN.md) · [Phase 3](docs/PHASE3-PLAN.md).

---

## Лицензия и контакты

Внутренний проект группы. Исходные материалы ПК «ОКО» — собственность правообладателя комплекса.
