# OKO — Портал форм корпоративной отчётности

Проект содержит веб-портал для создания и заполнения форм ОКО (корпоративная / специализированная отчётность).

## Быстрый старт

```bash
cd portal
npm install
npm run dev
```

## Состав

| Путь | Описание |
|------|----------|
| `portal/` | React-приложение (каталог и заполнение форм) |
| `portal/public/schemas/` | JSON-схемы 75 форм |
| `portal/public/pdf/` | Образцы PDF-шаблонов |
| `scripts/generate_schemas.py` | Парсер PDF → JSON-схемы |

Подробности — в [portal/README.md](portal/README.md).

## Деплой на Vercel

В настройках проекта Vercel укажите **Root Directory: `portal`**, затем задеплойте из GitHub или выполните `cd portal && vercel --prod`. Подробнее — [portal/README.md](portal/README.md#публикация-на-vercel).
