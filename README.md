# OKO — Портал форм корпоративной отчётности

Проект содержит веб-портал для создания и заполнения форм ОКО (корпоративная / специализированная отчётность).

## Быстрый старт

Требуется **Node.js 22+** (встроенный SQLite).

```bash
# API (SQLite, порт 3001)
cd server
npm install
npm run dev

# Портал (порт 5173, прокси /api → API)
cd portal
npm install
npm run dev
```

При первом запуске API данные из `localStorage` браузера автоматически мигрируют в `data/oko.db`. Без API портал работает в режиме localStorage (fallback).

## Состав

| Путь | Описание |
|------|----------|
| `server/` | Express API + SQLite (`data/oko.db`) |
| `portal/` | React-приложение (каталог и заполнение форм) |
| `portal/public/schemas/` | JSON-схемы 76 форм (из `z261.mdb`) |
| `portal/public/pdf/` | Образцы PDF-шаблонов |
| `portal/public/data/` | Правила проверок, сальdo, Excel-маппинг (из MDB) |
| `scripts/generate_schemas_from_mdb.py` | Генератор схем из MDB |
| `scripts/export_mdb_data.py` | Выгрузка правил и справочников из MDB |
| `data/schema.sql` | Схема БД аналога (SQLite/PostgreSQL) |
| `reference/` | Исходный комплект ОКО (MDB/MDE локально) |

Подробности — в [portal/README.md](portal/README.md).

## Деплой на Vercel

В настройках проекта Vercel укажите **Root Directory: `portal`**, затем задеплойте из GitHub или выполните `cd portal && vercel --prod`. Подробнее — [portal/README.md](portal/README.md#публикация-на-vercel).
