# ОКО — Портал форм корпоративной отчётности

Веб-портал для создания и заполнения **76 форм** корпоративной (специализированной) отчётности. Схемы форм генерируются из исходной базы ОКО `12345/z261.mdb`.

## Возможности

- Каталог всех форм с поиском и фильтрацией по разделам (N01–N19, ND)
- Заполнение табличных форм с колонками как в оригинальных PDF (графы B, C, D…)
- Предзаполненные строки показателей из шаблонов
- Сохранение черновиков в браузере (localStorage)
- Экспорт и импорт данных в JSON
- **Сохранение заполненной формы в PDF** (кириллица, таблица, реквизиты, подписи)
- Просмотр образца PDF для каждой формы
- Общие настройки организации и отчётного периода

## Запуск

```bash
cd portal
npm install
npm run dev
```

Откройте http://localhost:5173

## Сборка

```bash
npm run build
npm run preview
```

## Публикация на Vercel

Приложение лежит в папке `portal` — это важно указать в настройках проекта.

### Через GitHub (рекомендуется)

1. Закоммитьте и отправьте репозиторий на GitHub (`Kerimov/OKO`):
   ```bash
   cd /Users/vadim/OKO
   git add .
   git commit -m "OKO portal"
   git push -u origin main
   ```
2. В [vercel.com](https://vercel.com) → ваш проект → **Settings** → **General**:
   - **Root Directory:** `portal` (нажать Edit, указать `portal`)
   - **Framework Preset:** Vite (подставится автоматически)
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
3. **Deployments** → **Redeploy** (или подключите репозиторий в **Import Git Repository**).

После деплоя сайт откроется по адресу вида `https://ваш-проект.vercel.app`.

### Через CLI

```bash
npm i -g vercel
cd portal
vercel
```

При первом запуске выберите аккаунт и проект; для продакшена: `vercel --prod`.

### Маршруты React

В `vercel.json` настроен fallback на `index.html`, чтобы работали `/my`, `/settings` и т.д.

## Обновление данных из MDB

```bash
python scripts/generate_schemas_from_mdb.py   # схемы форм
python scripts/export_mdb_data.py             # правила, сальdo, Excel
```

## Администрирование

Раздел **Администрирование** (`/tools`):
- Полнота комплекта (76 форм)
- Проверка увязок (режимы: период / активные / все 3600)
- Пересчёт итоговых строк
- Перенос сальdo, агрегация
- Экспорт комплекта JSON / Excel

**Конструктор форм** (`/admin/forms`), **редактор увязок** (`/admin/checks`), **сальдо** (`/admin/saldo`) и **Excel-маппинг** (`/admin/excel`) — требуют API-сервер.

## Структура

- `portal/src/` — React-приложение
- `portal/public/schemas/` — схемы форм (колонки, строки)
- `portal/public/pdf/` — образцы PDF (локально, **не в git**; см. `public/pdf/README.md`)
- `scripts/generate_schemas_from_mdb.py` — генератор схем из MDB
