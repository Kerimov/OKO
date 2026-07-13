# Документация проекта OKO

Указатель всей проектной документации. Документы сгруппированы по назначению — для аудита, разработки и эксплуатации.

---

## Для аудита и руководства

| Документ | Описание |
|----------|----------|
| [AUDIT-OVERVIEW.md](AUDIT-OVERVIEW.md) | Обзор проекта для аудита: цели, этапы, объём работ, решения |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Техническая архитектура системы |
| [ОКО-архитектура-файлы-увязки.md](ОКО-архитектура-файлы-увязки.md) | Архитектура, описание файлов проекта и увязки (с примерами) |
| [PORTAL-GUIDE.md](PORTAL-GUIDE.md) | Руководство пользователя и администратора портала |
| [../CHANGELOG.md](../CHANGELOG.md) | Хронология разработки |
| [CHAT-LOG.md](CHAT-LOG.md) | Журнал решений из чата разработки |

---

## Для разработчиков

| Документ | Описание |
|----------|----------|
| [DEVELOPMENT.md](DEVELOPMENT.md) | Локальная среда, запуск, отладка, типичные задачи |
| [DEPLOY.md](DEPLOY.md) | Production: Vercel + Render, PostgreSQL, Docker |
| [PHASE2-PLAN.md](PHASE2-PLAN.md) | Этап 2: метаданные в БД, редакторы |
| [PHASE3-PLAN.md](PHASE3-PLAN.md) | Этап 3: сальдо, комплекты, личные кабинеты, агрегация |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Соглашения по коду и коммитам |

---

## Модули репозитория

| Документ | Описание |
|----------|----------|
| [../portal/README.md](../portal/README.md) | Фронтенд-приложение |
| [../server-nest/README.md](../server-nest/README.md) | NestJS REST API |
| [../server/README.md](../server/README.md) | Доменный слой API |
| [../data/README.md](../data/README.md) | Схемы базы данных |
| [../scripts/README.md](../scripts/README.md) | Скрипты выгрузки из MDB / acceptance-desktop |
| [../desktop/tauri/README.md](../desktop/tauri/README.md) | Целевой десктоп Tauri 2 |
| [DESKTOP-TAURI-PILOT.md](DESKTOP-TAURI-PILOT.md) | Пилот M5: установщики, SMB, нагрузка |
| [DESKTOP-TAURI-GAP-CHECKLIST.md](DESKTOP-TAURI-GAP-CHECKLIST.md) | Чеклист дыр Tauri vs ТЗ / §15 |
| [../desktop/filler/README.md](../desktop/filler/README.md) | Electron-пилот |
| [../reference/docs/oko-analysis.md](../reference/docs/oko-analysis.md) | Анализ исходного ПК «ОКО» |

---

## Исходники инструкции в портале

Текст раздела **Инструкция** в UI собирается из:

- `portal/src/content/instructions-user.md` — пользователь организации
- `portal/src/content/instructions-admin.md` — администратор
- `portal/src/content/instructions-appendix.md` — справочник

При правках синхронизируйте `docs/PORTAL-GUIDE.md` (конкатенация трёх файлов).
