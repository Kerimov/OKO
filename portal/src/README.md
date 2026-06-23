# Исходный код портала (`src/`)

Структура фронтенд-приложения. Один каталог — одна зона ответственности.

---

## `pages/` — экраны

Каждый файл — страница, подключённая в `App.tsx`.

| Файл | Маршрут | Описание |
|------|---------|----------|
| `EntryPage.tsx` | `/` | Точка входа (редирект) |
| `LoginPage.tsx` | — | Форма входа (используется в EntryPage) |
| `HomePage.tsx` | `/catalog` | Каталог 76 шаблонов |
| `MyFormsPage.tsx` | `/my` | Список экземпляров |
| `FormPage.tsx` | `/my/:id` | Редактор формы |
| `PackagePage.tsx` | `/package` | Комплект ZID/EID |
| `ToolsPage.tsx` | `/tools` | Пакетные операции (admin) |
| `SettingsPage.tsx` | `/settings` | Настройки |
| `InstructionsPage.tsx` | `/instructions` | Инструкция (markdown) |
| `FormsEditorPage.tsx` | `/admin/forms` | Редактор шаблонов |
| `ChecksEditorPage.tsx` | `/admin/checks` | Редактор увязок |
| `SaldoEditorPage.tsx` | `/admin/saldo` | Редактор сальдо |
| `ExcelEditorPage.tsx` | `/admin/excel` | Excel-маппинг |
| `RashEditorPage.tsx` | `/admin/rash` | Расшифровки |
| `AggregationEditorPage.tsx` | `/admin/aggregation` | Агрегация |
| `PackagesDashboardPage.tsx` | `/admin/packages` | Матрица комплектов |
| `UsersAdminPage.tsx` | `/admin/users` | Пользователи |
| `AuditLogPage.tsx` | `/admin/audit` | Журнал аудита |

---

## `components/` — UI

| Файл | Назначение |
|------|------------|
| `Layout.tsx` | Боковое меню, шапка |
| `AuthGate.tsx` | Защита маршрутов (авторизация) |
| `AdminAccessGate.tsx` | Ограничение admin-разделов |
| `FormTable.tsx` | Таблица ячеек формы |
| `CheckResultsPanel.tsx` | Панель результатов проверки |
| `MarkdownContent.tsx` | Рендер markdown-инструкции |

---

## `engine/` — бизнес-логика

Без React-зависимостей. Портировано из логики Access.

| Файл | Назначение |
|------|------------|
| `checkEngine.ts` | Проверка увязок |
| `recalcEngine.ts` | Пересчёт итогов |
| `saldoEngine.ts` | Перенос сальдо |
| `aggregateEngine.ts` | Агрегация экземпляров |
| `rashEngine.ts` | Проверка расшифровок |
| `exportExcel.ts` | Выгрузка Excel |
| `packageExport.ts` | Экспорт комплекта JSON |
| `completeness.ts` | Полнота комплекта 76/76 |
| `cellExpression.ts` | Вычисление выражений в ячейках |
| `instanceIndex.ts` | Индекс экземпляров для проверок |

---

## Прочие файлы

| Файл | Назначение |
|------|------------|
| `storage.ts` | Единая точка доступа к данным (API / localStorage) |
| `auth.ts` | login, logout, токены |
| `useAuth.ts` | React-хук состояния авторизации |
| `apiClient.ts` | HTTP-обёртка с credentials |
| `api.ts` | Загрузка каталога и схем |
| `packagesApi.ts` | API организаций и периодов |
| `aggregationApi.ts` | API агрегации |
| `exportPdf.ts` | Генерация PDF (pdfmake) |
| `types.ts` | Общие типы |
| `constants.ts` | Константы |
| `authRouting.ts` | Редиректы после входа |

---

## `content/` — инструкции

Markdown-файлы для `InstructionsPage`. Не импортируются в код напрямую — через `?raw` в Vite.
