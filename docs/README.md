# Документация проекта OKO

Указатель всей проектной документации. Документы сгруппированы по назначению — для аудита, разработки и эксплуатации.

---

## Для аудита и руководства

| Документ | Описание |
|----------|----------|
| [AUDIT-OVERVIEW.md](AUDIT-OVERVIEW.md) | Обзор проекта для аудита: цели, этапы, объём работ, решения |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Техническая архитектура системы |
| [PORTAL-GUIDE.md](PORTAL-GUIDE.md) | Руководство пользователя и администратора портала |
| [../CHANGELOG.md](../CHANGELOG.md) | Хронология разработки |
| [CHAT-LOG.md](CHAT-LOG.md) | Журнал решений из чата разработки |
| [OFFLINE-EXCHANGE.md](OFFLINE-EXCHANGE.md) | Офлайн-обмен с дочерними организациями |

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
| [../server/README.md](../server/README.md) | REST API |
| [../data/README.md](../data/README.md) | Схемы базы данных |
| [../scripts/README.md](../scripts/README.md) | Скрипты выгрузки из MDB |
| [../reference/README.md](../reference/README.md) | Эталонный комплект Access |
| [../reference/docs/oko-analysis.md](../reference/docs/oko-analysis.md) | Анализ исходного ПК «ОКО» |

---

## Исходники инструкции в портале

Текст раздела **Инструкция** в UI собирается из:

- `portal/src/content/instructions-user.md` — пользователь организации
- `portal/src/content/instructions-admin.md` — администратор
- `portal/src/content/instructions-appendix.md` — справочник

При правках синхронизируйте `docs/PORTAL-GUIDE.md` (конкатенация трёх файлов).
