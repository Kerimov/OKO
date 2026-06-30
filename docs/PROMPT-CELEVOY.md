# Промпт: целевой путь приведения OKO к ТЗ

Используй этот промпт для жёсткой миграции на выбранный целевой стек без переходных формулировок.

---

Ты работаешь в репозитории /Users/vadim/OKO.

Задача:
Привести проект OKO к целевой архитектуре, определённой по итогам анализа legacy Access-комплекта и ТЗ docs/TZ-OKO-IMPORTOZAMESHENIE.docx.

Нужно не «улучшить текущий прототип», а привести реализацию к выбранному целевому стеку и требованиям ТЗ.

Исходная система:
ПК «ОКО» на Microsoft Access. Исходный комплект лежит в /Users/vadim/OKO/12345:
- 12345/OKO26-1.mde — Access-приложение, UI + скомпилированный VBA;
- 12345/z261.mdb — основная БД с метаданными форм, увязками, сальдо, справочниками;
- 12345/ini20261.ini — конфигурация;
- 12345/txt2026-1KV.TXT — руководство пользователя;
- 12345/Проверка увязок.docx — описание механизма проверок;
- 12345/СхемаБД.png — схема БД;
- 12345/ШаблоныФорм-МинФин.xlsx — Excel-шаблон.

Целевой стек:
- Frontend: React + TypeScript.
- Backend: NestJS + TypeScript.
- DB ЦО: PostgreSQL / Postgres Pro.
- Desktop: Tauri 2 + React + Rust.
- Desktop DB: native SQLite с WAL.
- Reverse proxy: Nginx / Angie.
- Auth: Keycloak / LDAP / внутренний SSO.
- Deployment: Docker / on-prem на Astra Linux, ALT Linux или РЕД ОС.
- Reports: Excel/PDF export.
- Production-контур: без Vercel, Render, GitHub-hosted runtime и внешних облачных зависимостей.

Жёсткие архитектурные решения:
1. Backend должен быть переведён на NestJS.
2. Express не является целевым backend и должен быть заменён.
3. Fastify не используется в реализации. Он может упоминаться только в ТЗ как альтернативный вариант, но не в коде целевого проекта.
4. Electron не является целевым desktop runtime и должен быть заменён на Tauri 2.
5. sql.js не является допустимой целевой БД для desktop и должен быть заменён на native SQLite.
6. localStorage не является допустимым production-хранилищем.
7. Статические JSON не должны быть источником истины для методологии. Источник истины — PostgreSQL/Postgres Pro.
8. Проверки должны выполняться на сервере обязательно. Клиентские проверки допустимы только как UX-ускорение.
9. Все изменения должны соответствовать docs/TZ-OKO-IMPORTOZAMESHENIE.docx.

Перед началом изучить:
1. docs/TZ-OKO-IMPORTOZAMESHENIE.docx
2. docs/generate_tz_oko_docx.py
3. docs/ARCHITECTURE.md
4. docs/PHASE2-PLAN.md
5. docs/PHASE3-PLAN.md
6. reference/docs/oko-analysis.md
7. docs/DESKTOP-FILLER-TZ.md
8. README.md
9. data/README.md
10. portal/src/engine/*
11. server/src/*
12. desktop/filler/*
13. 12345/*

Целевая предметная модель:
Метаданные и правила должны храниться в БД:
- organizations;
- periods;
- form_templates;
- form_template_rows;
- form_template_columns;
- form_instances;
- form_cell_values;
- check_rules;
- saldo_rules;
- form_correspondence;
- kontr_agents;
- rash_rules;
- excel_mappings;
- agg_list;
- users;
- roles;
- audit_log.

Соответствие Access → новая система:
- a_tblZIDs → organizations;
- a_tblPERs → periods;
- a_stblTABLES → form_templates;
- a_stblROWs → form_template_rows;
- a_stblFIELDs → form_template_columns;
- таблицы N01_* … ND* → form_instances + form_cell_values;
- a_tblchecks → check_rules;
- a_tblsaldo → saldo_rules;
- FormCorrespondence → form_correspondence;
- sp_kontr → kontr_agents;
- sp_rash / t_ras → rash_rules + данные расшифровок;
- tblExcelExport → excel_mappings;
- a_tblAgg_List → agg_list;
- tblConfig → settings/config tables;
- OKO26-k.mde UI → React portal + Tauri desktop;
- CheckIt / iEvalExp → server-side validation engine + client-side mirror.

Главные работы:

Этап 1. Аудит текущего проекта
Сравнить текущую реализацию с ТЗ и целевым стеком.
Выдать список:
- что уже можно сохранить;
- что должно быть заменено;
- чего не хватает;
- какие файлы затронуть.

Особое внимание:
- server/src/*
- data/schema.sql
- data/schema.postgresql.sql
- portal/src/engine/*
- portal/src/pages/*
- desktop/filler/*
- scripts/*mdb*
- docs/*

Этап 2. Миграция backend на NestJS
Цель:
Заменить Express backend на NestJS backend.

Требования:
- создать модульную структуру NestJS:
  - AuthModule;
  - UsersModule;
  - OrganizationsModule;
  - PeriodsModule;
  - WorkContextModule;
  - FormsModule;
  - InstancesModule;
  - PackagesModule;
  - ChecksModule;
  - SaldoModule;
  - RashModule;
  - KontrModule;
  - ExcelModule;
  - AggregationModule;
  - AuditModule;
  - SettingsModule.
- сохранить REST-контракты, необходимые фронтенду;
- добавить DTO и validation pipes;
- добавить guards для ролей;
- добавить единый exception filter;
- добавить logging/interceptors;
- добавить OpenAPI/Swagger;
- подключить PostgreSQL/Postgres Pro;
- SQLite оставить только для локальной разработки, если это нужно, но не как production-цель.

API должен покрывать:
- GET /api/health
- POST /api/auth/login
- POST /api/auth/logout
- GET /api/auth/me
- GET /api/audit
- GET/PUT /api/settings
- GET/PUT /api/work-context
- GET/POST /api/organizations
- GET/POST /api/periods
- GET/POST/PUT/PATCH/DELETE /api/instances
- GET/POST/DELETE /api/packages
- GET/PUT/POST /api/forms
- GET/POST/PUT/DELETE /api/checks
- GET/POST/PUT/DELETE /api/saldo
- GET/PUT /api/correspondence
- GET/POST/PUT/DELETE /api/rash
- GET/POST /api/kontr
- GET/POST/PUT/DELETE /api/excel
- GET/POST/PUT/DELETE /api/aggregation

Этап 3. БД и миграции
Цель:
Привести БД к модели ТЗ.

Сделать:
- schema.postgresql.sql как основной production schema;
- миграции для всех таблиц методологии и данных;
- audit_log для всех значимых изменений;
- нормализованное хранение ячеек в form_cell_values;
- индексы по zid/eid/template_id/instance_id;
- constraints для целостности;
- seed/import из Access-derived JSON/MDB.

Не допускать:
- хранения критичных данных только в JSON blob;
- хранения методологии только в portal/public/data;
- production-зависимости от localStorage.

Этап 4. Доменный движок ОКО
Цель:
Вынести бизнес-логику ОКО в общий доменный слой, используемый и сервером, и фронтендом.

Движки:
- cellExpression;
- checkEngine;
- checkRunCore;
- recalcEngine;
- saldoEngine;
- rashEngine;
- aggregateEngine;
- packageExport/packageImport;
- exportExcel.

Требования:
- сервер выполняет обязательную проверку перед submitted;
- фронтенд может выполнять те же проверки для UX;
- результаты серверных проверок пишутся в audit/log или validation result;
- движки не должны зависеть от DOM/React.

Этап 5. Административный контур
Реализовать/довести:
- редактор увязок;
- конструктор форм;
- редактор сальдо;
- редактор соответствий FormCorrespondence;
- редактор правил расшифровок;
- редактор Excel-маппинга;
- справочник контрагентов;
- пользователи и роли;
- аудит.

Все изменения методологии должны:
- сохраняться в PostgreSQL;
- иметь created_at/updated_at;
- иметь updated_by;
- попадать в audit_log;
- иметь возможность экспорта/импорта.

Этап 6. Frontend React
React + TypeScript оставить как целевой frontend.

Привести UI к ТЗ:
- вход / SSO;
- дашборд комплектов;
- каталог форм;
- Мои формы;
- редактор формы;
- Сводка и импорт;
- редактор увязок;
- конструктор форм;
- редактор сальдо;
- редактор Excel-маппинга;
- справочник контрагентов;
- пользователи;
- аудит.

Требования:
- фронтенд работает через NestJS API;
- localStorage используется только для временных UI-настроек, не для production-данных;
- формы строятся из метаданных БД;
- клиентские JSON — только fallback/dev/export, не источник истины.

Этап 7. ReportPackage
Цель:
Зафиксировать единый контракт обмена.

Сделать ReportPackage v1.2:
- version;
- organization;
- periodStart;
- periodEnd;
- zid;
- eid;
- instances[];
- optional rules bundle;
- metadata version;
- exportedAt;
- exportedBy.

Реализовать:
- export package;
- import package;
- validation package schema;
- backward compatibility для v1.1, если уже есть файлы;
- тесты portal export → server import;
- тесты desktop export → server import;
- тесты overwrite / non-overwrite;
- тесты ошибок импорта.

Этап 8. Desktop: миграция на Tauri
Цель:
Заменить desktop/filler на целевую архитектуру Tauri 2 + React + Rust + native SQLite.

Сделать:
- создать Tauri desktop app;
- переиспользовать React UI там, где возможно;
- реализовать Rust commands для:
  - открытия папки комплекта;
  - создания комплекта;
  - импорта JSON от ЦО;
  - сохранения ячеек;
  - блокировки ячеек;
  - синхронизации presence;
  - backup/restore;
  - экспорта JSON в ЦО;
  - проверки целостности БД.
- заменить sql.js на native SQLite;
- включить WAL;
- реализовать busy timeout;
- реализовать integrity_check;
- реализовать backup oko.db;
- протестировать сетевую папку SMB;
- добавить сборку Windows;
- добавить целевую сборку Linux для Astra/ALT/РЕД ОС.

Структура папки комплекта:
- package.meta.json;
- oko.db;
- assignments.json;
- backups/;
- exports/;
- .oko/ logs/config.

Запрещено:
- использовать sql.js как целевую БД;
- оставлять Electron как целевой runtime;
- строить новую логику вокруг WASM SQLite.

Этап 9. Импортозамещение и deployment
Сделать:
- Docker/on-prem deployment;
- Nginx или Angie reverse proxy;
- PostgreSQL/Postgres Pro;
- Keycloak/LDAP integration;
- internal npm registry или mirror;
- SBOM;
- документация по сборке без внешних облаков;
- подпись desktop-релизов;
- инструкции для Astra/ALT/РЕД ОС.

Убрать из production-документации:
- Vercel как целевой production;
- Render как целевой production;
- GitHub-hosted runtime как production-зависимость.

Этап 10. Тесты
Добавить тесты:
- cellExpression;
- checkEngine;
- server-side checks;
- recalcEngine;
- saldoEngine;
- rashEngine;
- package import/export;
- form metadata CRUD;
- checks CRUD;
- server submitted validation;
- audit logging;
- desktop package import/export;
- SQLite integrity/backup;
- e2e:
  - создать комплект;
  - заполнить форму;
  - запустить проверку;
  - исправить ошибку;
  - сдать форму;
  - экспортировать;
  - импортировать в ЦО;
  - агрегировать.

Этап 11. Документация
Обновить:
- docs/TZ-OKO-IMPORTOZAMESHENIE.docx;
- docs/generate_tz_oko_docx.py;
- docs/ARCHITECTURE.md;
- docs/DEPLOY.md;
- docs/PHASE2-PLAN.md;
- docs/PHASE3-PLAN.md;
- docs/DESKTOP-FILLER-TZ.md;
- README.md.

В документации должно быть чётко:
- Backend: NestJS + TypeScript.
- Fastify: только как альтернативный вариант в ТЗ, не реализация.
- Desktop: Tauri 2 + React + Rust.
- Desktop DB: native SQLite с WAL.
- sql.js исключён из целевой архитектуры.
- Electron исключён из целевой архитектуры.
- ЦО DB: PostgreSQL/Postgres Pro.
- Production: on-prem / импортозамещённый контур.
- localStorage не production-хранилище.
- JSON не источник истины методологии.

Правила работы:
- Не коммитить 12345/.
- Не коммитить dist-offline/.
- Не коммитить .env, секреты, пароли.
- Не удалять пользовательские файлы.
- Все изменения делать по этапам.
- Перед большими изменениями показать план.
- После этапа запускать build/test.
- Если тестов нет — добавить минимальные.
- Если текущие тесты падают до изменений — зафиксировать это отдельно.

Ожидаемый первый результат:
Не кодить сразу всё.
Сначала подготовь подробный технический план миграции по файлам и этапам:
1. Что удалить/заменить.
2. Что сохранить.
3. Какие новые модули создать.
4. Какие схемы БД изменить.
5. Какие API перенести.
6. Какие тесты добавить.
7. Какие риски есть.
8. Какая последовательность PR/коммитов оптимальна.

После согласования плана переходи к реализации.
