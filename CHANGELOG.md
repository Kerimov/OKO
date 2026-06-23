# Changelog

Все значимые изменения проекта OKO. Формат основан на [Keep a Changelog](https://keepachangelog.com/).

---

## [Unreleased]

### Документация
- Структурирование репозитория для аудита: ARCHITECTURE, AUDIT-OVERVIEW, DEVELOPMENT, README по модулям.

---

## [2026-06] — Инструкции и UX

### Added
- Встроенная страница **Инструкция** (`/instructions`) с вкладками по ролям.
- Полное руководство `docs/PORTAL-GUIDE.md`.
- Массовое удаление форм на **Мои формы**.
- Панель редактирования пользователя в админке.

### Changed
- Главная страница `/` — экран входа (ранее каталог).
- Единый хук `useAuth` для согласованного состояния авторизации.
- Боковое меню вместо верхней навигации.

### Fixed
- Бесконечный re-render в `useAuth` (React error #185).
- Рассинхрон UI авторизации между страницами.
- Ошибки дат PostgreSQL при пустых полях периода.
- Пропущенные импорты в маршрутах агрегации.

---

## [2026-06] — Production и PostgreSQL

### Added
- Поддержка **PostgreSQL** (`data/schema.postgresql.sql`, `OkoDb` abstraction).
- Деплой API на Render, портал на Vercel (`docs/DEPLOY.md`).
- Docker Compose с профилем `postgres`.

### Changed
- Production хранение данных в managed PostgreSQL вместо SQLite volume.

---

## [2026-06] — Phase 3: бизнес-логика

### Added
- Комплекты: организации (ZID), периоды (EID), заведение 76 форм (`/package`).
- Перенос сальдо: FormCorrespondence + a_tblsaldo (`/tools`).
- Проверка расшифровок sp_rash (`/admin/rash`).
- Пересчёт итоговых строк (recalc engine).
- Учётные записи org/admin с привязкой к ZID.
- Агрегация комплекта и ручная агрегация.
- Статусы форм: черновик / сдано.
- Дашборд комплектов (`/admin/packages`).

---

## [2026-06] — Phase 2: API и редакторы

### Added
- Express API (`server/`) с SQLite.
- Редакторы метаданных: формы, увязки, сальдо, Excel (`/admin/*`).
- Движок проверок увязок на клиенте (`checkEngine.ts`).
- Журнал аудита метаданных (`/admin/audit`).
- Миграция localStorage → SQLite при первом запуске API.
- Fallback портала на JSON без API.

---

## [2026-06] — Phase 1: MVP

### Added
- React-портал: каталог 76 форм, редактор таблиц.
- JSON-схемы из `z261.mdb` (`scripts/generate_schemas_from_mdb.py`).
- Сохранение в localStorage, импорт/экспорт JSON.
- Экспорт заполненной формы в PDF.
- Правила проверок и сальдо из MDB (`scripts/export_mdb_data.py`).

---

[Unreleased]: https://github.com/Kerimov/OKO/compare/0700d87...HEAD
[2026-06]: https://github.com/Kerimov/OKO/commits/main
