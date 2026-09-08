# Промпт: альтернативный путь приведения OKO к ТЗ

Используй этот промпт, если допускается поэтапная миграция без немедленной замены Express и Electron.

---

Ты работаешь в репозитории /Users/vadim/OKO.

Контекст проекта:
Нужно привести текущую реализацию OKO к техническому заданию docs/TZ-OKO-IMPORTOZAMESHENIE.docx и нашему архитектурному анализу. Проект заменяет legacy-систему ПК «ОКО» на Microsoft Access. Исходный Access-комплект лежит в папке 12345:
- 12345/OKO26-1.mde — Access-приложение, UI + скомпилированный VBA;
- 12345/z261.mdb — база с метаданными форм, увязками, сальдо, справочниками;
- 12345/ini20261.ini — конфиг;
- 12345/txt2026-1KV.TXT — руководство пользователя;
- 12345/Проверка увязок.docx — описание проверок;
- 12345/СхемаБД.png — схема БД;
- 12345/ШаблоныФорм-МинФин.xlsx — Excel-шаблон.

Главная цель:
Исправить и развить текущий проект так, чтобы он соответствовал ТЗ: импортозамещённая замена Access для заполнения, проверки, формирования, агрегации и передачи отчётных форм ОКО.

Ключевой вывод анализа:
Текущая реализация не является ошибкой, но её нужно усилить. React + TypeScript оставить. PostgreSQL/Postgres Pro оставить как целевую БД ЦО. Backend нужно привести к более строгой архитектуре: основной целевой вариант NestJS, допустимая альтернатива Fastify. Express можно оставить только как переходный этап, если миграция делается постепенно. Desktop-пилот на Electron + sql.js считать временным; для промышленного desktop целевой стек: Tauri 2 + React + Rust + native SQLite, не sql.js.

Изучи перед началом:
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

Текущий стек:
- portal/ — React + TypeScript + Vite;
- server/ — сейчас Express + TypeScript;
- data/ — SQLite/PostgreSQL схемы;
- portal/public/schemas и portal/public/data — JSON, выгруженные из Access MDB;
- desktop/filler — текущий desktop-пилот на Electron + sql.js;
- 12345 — исходный Access-комплект.

Целевой стек по ТЗ:
- Frontend: React + TypeScript;
- Backend основной: NestJS + TypeScript;
- Backend альтернатива: Fastify + TypeScript;
- DB ЦО: PostgreSQL / Postgres Pro;
- Offline desktop: Tauri 2 + React + Rust + native SQLite;
- Reverse proxy: Nginx / Angie;
- Auth: Keycloak / LDAP / внутренний SSO;
- Reports: Excel/PDF export;
- Deployment: Docker/on-prem на Astra Linux / ALT / РЕД ОС;
- В production не использовать Vercel/Render/GitHub как целевой контур РФ.

Главные замечания, которые нужно устранить:
1. Метаданные форм и правил не должны оставаться только статическими JSON.
   Источник истины должен быть в БД:
   - form_templates;
   - form_template_rows;
   - form_template_columns;
   - check_rules;
   - saldo_rules;
   - form_correspondence;
   - rash_rules;
   - excel_mappings;
   - agg_list.

2. Сервер должен выполнять обязательные проверки.
   Сейчас часть логики работает на клиенте. Для промышленного режима:
   - проверки на клиенте оставить для удобства;
   - серверные проверки сделать обязательными перед сдачей формы/комплекта;
   - checkEngine/checkRunCore вынести в общий доменный пакет или общий слой.

3. Хранение данных форм должно быть нормализовано.
   Не полагаться только на JSON blob. Нужны:
   - form_instances;
   - form_cell_values;
   - updated_at;
   - updated_by;
   - audit_log.

4. Нужно довести административный контур:
   - редактор увязок;
   - конструктор форм;
   - редактор сальдо;
   - редактор Excel-маппинга;
   - редактор правил расшифровок;
   - аудит изменений методологии.

5. Нужно синхронизировать формат ReportPackage.
   Зафиксировать версию, например 1.2:
   - version;
   - organization;
   - periodStart;
   - periodEnd;
   - zid;
   - eid;
   - instances[];
   - optional rules bundle.
   Добавить тесты совместимости:
   - portal export -> server import;
   - desktop export -> server import;
   - old package version -> current import.

6. Desktop:
   Текущий Electron + sql.js не считать промышленным вариантом.
   Нужно либо:
   - оставить его как временный пилот;
   - либо спланировать миграцию на Tauri 2 + native SQLite.
   В любом случае:
   - не использовать sql.js/WASM как целевую БД;
   - использовать native SQLite с WAL;
   - backup/restore;
   - integrity check;
   - тесты на сетевой папке SMB;
   - JSON-обмен с ЦО.

7. Импортозамещение:
   - production должен быть on-prem или российский контур;
   - PostgreSQL/Postgres Pro;
   - Astra/ALT/РЕД ОС;
   - внутренний npm registry / mirror;
   - SBOM;
   - подпись desktop-релизов;
   - отсутствие внешних runtime-зависимостей в production.

8. Не переписывать всё без необходимости.
   Сохранять уже реализованные полезные части:
   - React UI;
   - JSON-схемы форм;
   - checkEngine;
   - recalcEngine;
   - saldoEngine;
   - rashEngine;
   - aggregateEngine;
   - exportExcel;
   - packageExport/packageImport;
   - текущие выгрузки из MDB;
   - текущую PostgreSQL-модель, если она соответствует ТЗ.

Работай поэтапно.

Этап 1. Аудит текущей реализации
- Сравни текущую структуру с ТЗ.
- Составь gap-list:
  - реализовано;
  - частично реализовано;
  - отсутствует;
  - противоречит ТЗ.
- Особое внимание:
  - server/src/index.ts;
  - server/src/packages.ts;
  - server/src/instances.ts;
  - server/src/checks.ts;
  - server/src/saldo.ts;
  - server/src/forms.ts;
  - data/schema.sql;
  - data/schema.postgresql.sql;
  - portal/src/pages/*admin*;
  - portal/src/engine/*;
  - desktop/filler/electron/db/sqliteDb.ts;
  - desktop/filler/electron/db/packageDb.ts.

Этап 2. Приведение БД к ТЗ
- Проверить наличие и качество таблиц:
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
  - audit_log.
- Если таблицы отсутствуют или неполные, доработать обе схемы:
  - data/schema.sql;
  - data/schema.postgresql.sql.
- Добавить миграционный/seed-процесс из JSON/MDB-выгрузок.

Этап 3. Backend
Выбрать путь:
A. Основной путь: миграция Express -> NestJS.
B. Альтернативный путь: миграция Express -> Fastify.
C. Переходный путь: оставить Express, но структурировать модули так, чтобы REST-контракты соответствовали ТЗ.

Важно:
- REST-контракты должны быть независимы от выбора NestJS/Fastify.
- API должен покрывать:
  - /api/auth;
  - /api/organizations;
  - /api/periods;
  - /api/work-context;
  - /api/instances;
  - /api/packages;
  - /api/forms;
  - /api/checks;
  - /api/saldo;
  - /api/correspondence;
  - /api/rash;
  - /api/kontr;
  - /api/excel;
  - /api/aggregation;
  - /api/audit.
- Добавить серверную проверку перед submitted.
- Добавить аудит изменений:
  - ячеек;
  - статусов;
  - увязок;
  - форм;
  - сальдо;
  - справочников.

Этап 4. Frontend
- Привести UI к ТЗ:
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
  - пользователи и аудит.
- Сохранить React + TypeScript.
- Не хранить критичные данные только в localStorage в production.
- Клиентские проверки оставить для удобства, но не считать их единственным контролем.

Этап 5. Access/MDB migration
- Проверить скрипты:
  - scripts/generate_schemas_from_mdb.py;
  - scripts/export_mdb_data.py;
  - scripts/explore_mdb.py.
- Убедиться, что из z261.mdb переносятся:
  - a_stblROWs;
  - a_stblFIELDs;
  - a_tblchecks;
  - a_tblsaldo;
  - FormCorrespondence;
  - sp_kontr;
  - sp_rash;
  - tblExcelExport;
  - a_tblAgg_List.
- Добавить команды или документацию для ежеквартального обновления методологии.

Этап 6. ReportPackage
- Зафиксировать схему ReportPackage v1.2.
- Обновить portal/server/desktop так, чтобы они понимали один контракт.
- Добавить backward compatibility для v1.1, если уже есть файлы.
- Добавить тесты:
  - import valid package;
  - reject invalid package;
  - overwrite/non-overwrite;
  - preserve submitted status;
  - preserve zid/eid mapping.

Этап 7. Desktop
- Явно отметить Electron + sql.js как пилот.
- Для промышленного варианта подготовить план миграции:
  - Tauri 2;
  - React UI reuse;
  - Rust commands;
  - native SQLite;
  - WAL;
  - backup;
  - sync/presence;
  - package.meta.json;
  - assignments.json;
  - exports/.
- Если трогаешь текущий desktop:
  - не усиливай sql.js как целевой путь;
  - не добавляй сложную логику вокруг WASM SQLite вместо native SQLite;
  - синхронизируй ReportPackage.

Этап 8. Tests
Добавить/обновить тесты:
- unit для checkEngine/cellExpression;
- unit для recalc/saldo/rash;
- API tests для packages/import;
- API tests для checks CRUD;
- API tests для forms metadata;
- e2e scenario:
  - create package;
  - fill form;
  - run checks;
  - submit;
  - export;
  - import to another org/period;
  - aggregate.

Этап 9. Docs
Обновить:
- docs/ARCHITECTURE.md;
- docs/DEPLOY.md;
- docs/PHASE2-PLAN.md;
- docs/PHASE3-PLAN.md;
- docs/DESKTOP-FILLER-TZ.md;
- docs/TZ-OKO-IMPORTOZAMESHENIE.docx, если меняется ТЗ;
- README.md.

Обязательно отразить:
- основной backend: NestJS;
- альтернатива: Fastify;
- Express как переходный этап;
- desktop target: Tauri + native SQLite;
- SQLite допускается для desktop как embedded open-source компонент при SBOM и контролируемой поставке;
- sql.js не является целевым промышленным вариантом;
- ЦО DB: PostgreSQL/Postgres Pro.

Требования к реализации:
- Не ломать существующие пользовательские сценарии без причины.
- Не удалять пользовательские/неотслеживаемые файлы.
- Не коммитить 12345/ и dist-offline.
- Не коммитить секреты, .env, пароли.
- Все изменения делать небольшими логическими шагами.
- После каждого значимого этапа запускать:
  - npm test / npm run build для portal;
  - npm test / npm run build для server;
  - если трогался desktop — npm run build в desktop/filler.
- Если тестов нет, добавить минимальные.
- Если сборка не проходит из-за старых проблем, явно описать, что сломано до изменений.

Критерии готовности:
1. ТЗ и архитектура не противоречат реализации.
2. Метаданные Access постепенно переходят в БД.
3. Увязки редактируются через UI и сохраняются в БД.
4. Проверки выполняются не только на клиенте, но и на сервере.
5. Форма/комплект нельзя считать сданными без серверной проверки.
6. ReportPackage имеет единый версионированный контракт.
7. Desktop-путь приведён к целевой архитектуре или явно задокументирован как пилот.
8. В документации чётко указаны NestJS и Fastify как варианты backend, а также условия выбора.
9. Трудозатраты в ТЗ указаны в часах.
10. Проект остаётся пригодным для импортозамещённого контура РФ.

Начни с аудита и предложи план изменений по файлам. Не переписывай всё сразу. Сначала покажи:
- что уже соответствует ТЗ;
- что противоречит ТЗ;
- какие изменения нужны в первую очередь;
- какие изменения лучше отложить.
