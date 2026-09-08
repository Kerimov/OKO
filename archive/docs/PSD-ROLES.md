# ПСД: роли и маршруты

## Legacy → PSD mapping

| `users.role` | default `psd_role` |
|--------------|--------------------|
| `admin` | `support_specialist` |
| `org` | `subsidiary_specialist` |

Дополнительно назначаются: `business_process_manager`, `department_curator`, `auditor_readonly`.

## Permissions (server)

См. `server/src/psdRoles.ts`. Ключевые:

- `bp.*` — мониторинг и переходы БП
- `forms.read` / `forms.write` — ввод
- `nsi.read` / `nsi.write` — справочники
- `approval.explain` — объяснения расхождений
- `tech.configure` — настройки/маппинги
- `audit.read_only` — аудитор

`auditor_readonly` блокируется `RejectReadOnlyGuard` на мутациях.

## UI routes

| Path | Назначение |
|------|------------|
| `/bp` | Мониторинг БП |
| `/package` | Комплект + панель БП / OKO|BALANCE |
| `/collection-units` | Иерархия единиц сбора |
| `/check-explanations` | Журнал / объяснения / прогон DSL |
| `/integrations` | Своды / переносы / МинФин / статус портов |
| `/psd-reports` | Отчёты сопровождения + МинФин export |
| `/admin/users` | Legacy + PSD-роль + locale |

## API (Nest)

- `GET/POST /api/business-processes*`
- `GET/PUT /api/collection-units*`
- `GET/POST /api/kontr-versions*`
- `GET/POST /api/psd-checks*` (explanations, journal, dsl-rules, dsl/run)
- `GET/POST /api/support-reports*`
- `GET/POST /api/svods*`
- `GET/POST /api/transfers*` (+ `/apply`)
- `GET/POST /api/minfin*`
- `GET/POST /api/cell-comments*`
- `GET/POST /api/integrations*` (ports only; no fake DO/SAP/EDS)

## BP statuses

`not_started` → `collecting` → `pending_curator_approval` → `curator_approved` → `completed`

После `completed` формы пакета блокируются (`assertFormsWritableForBp`). До `start` ввод также заблокирован.

Приёмка без интеграций: [PSD-ACCEPTANCE.md](./PSD-ACCEPTANCE.md).
