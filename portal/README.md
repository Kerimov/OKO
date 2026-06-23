# Портал OKO — фронтенд

React-приложение для заполнения **76 форм** корпоративной отчётности. Деплоится на **Vercel** (Root Directory: `portal`).

---

## Запуск

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production → dist/
npm run preview   # просмотр сборки
```

Прокси API: `/api` → `http://localhost:3001` (см. `vite.config.ts`).

---

## Структура

```
portal/
├── src/
│   ├── pages/          # Экраны (маршруты)
│   ├── components/     # UI-компоненты
│   ├── engine/         # Бизнес-логика (проверки, пересчёт, сальдо)
│   ├── content/        # Markdown-инструкции
│   ├── App.tsx         # Маршрутизация
│   ├── Layout.tsx      # Боковое меню
│   ├── storage.ts      # API ↔ localStorage
│   └── auth.ts         # Авторизация
├── public/
│   ├── schemas/        # 76 JSON-шаблонов форм
│   ├── data/           # Правила (fallback без API)
│   └── pdf/            # Образцы PDF (локально, не в git)
├── vercel.json         # SPA fallback
└── package.json
```

Подробнее о `src/`: [src/README.md](src/README.md).

---

## Маршруты

| Путь | Страница |
|------|----------|
| `/` | Вход |
| `/catalog` | Каталог шаблонов |
| `/my` | Мои формы |
| `/my/:id` | Редактор формы |
| `/package` | Комплект (ZID/EID) |
| `/tools` | Сводка и импорт (admin) |
| `/admin/*` | Редакторы, пользователи, аудит |
| `/settings` | Настройки |
| `/instructions` | Инструкция |

---

## Публикация на Vercel

1. **Settings → General → Root Directory:** `portal`
2. **Environment Variables:** `VITE_API_URL` = URL production API
3. Deploy из GitHub или `vercel --prod`

`vercel.json` настроен на SPA fallback (`index.html` для `/my`, `/settings` и т.д.).

---

## Обновление данных форм

```bash
# из корня репозитория
python scripts/generate_schemas_from_mdb.py
python scripts/export_mdb_data.py
```

---

## Инструкция в UI

Исходники раздела **Инструкция**:

- `src/content/instructions-user.md`
- `src/content/instructions-admin.md`
- `src/content/instructions-appendix.md`

Синхронизация с `docs/PORTAL-GUIDE.md` — см. [docs/README.md](../docs/README.md).

---

## См. также

- [docs/PORTAL-GUIDE.md](../docs/PORTAL-GUIDE.md) — руководство пользователя
- [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
- [server/README.md](../server/README.md)
