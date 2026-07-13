# OKO Заполнение — Tauri 2 (целевой десктоп)

Целевой стек по ТЗ: **Tauri 2 + React + rusqlite (WAL)**.  
Пилот на Electron остаётся в [`../filler`](../filler) до полного паритета установщиков.

## UI

Фронт совпадает с Electron filler: `Layout`, Welcome / Package / Form / Assignments / Admin, те же стили.  
Доступ к SQLite — через `window.oko` (`src/okoBridge.ts` → Tauri `invoke`).

## Срез M1–M5

- **M1:** открытие комплекта, список форм, редактор, save
- **M2:** presence / heartbeat / sync / per-cell save
- **M3:** назначения, PIN координатора, статусы, «Мои формы»
- **M4:** бэкап, экспорт/импорт JSON, увязки, force-unlock
- **M5:** сборка установщиков (dmg/nsis/msi), [пилот-док](../../docs/DESKTOP-TAURI-PILOT.md), smoke 10 клиентов

Ограничения пилота: часть rash/recalc rule engine на стороне bridge упрощена; code signing / нотаризация.

## Требования

- Node.js 22+
- [Rust](https://rustup.rs/) (stable)
- macOS: Xcode CLT · Windows: VS Build Tools · Linux: webkit2gtk

## Запуск (dev)

```bash
cd desktop/tauri
npm install
npm run dev:tauri
```

Только Vite: `npm run dev` → http://localhost:1420

## Сборка установщика

```bash
npm run build:tauri
# или точечно:
npm run build:tauri:dmg    # macOS
npm run build:tauri:nsis   # Windows NSIS
```

Артефакты: `src-tauri/target/release/bundle/`.

Иконки: `npm run icons` (из `src-tauri/icons/icon.png`).

## Нагрузка (без GUI)

```bash
python3 ../../scripts/tauri-collab-smoke.py /path/to/package --clients 10 --seconds 20
```

## Команды Rust (сводка)

| Группа | Commands |
|--------|----------|
| Пакет | `open_package`, `close_package`, `create_empty_package`, `list_summaries`, `load/save_instance` |
| Файлы | `read_text_file`, `write_text_file`, `write_bytes_file`, `copy_file` |
| Collab | `claim_cell`, `heartbeat_cell`, `release_presence`, `list_instance_presence`, `list_package_editors`, `save_cell`, `list_cell_changes` |
| M3 | `get/save_assignments`, `*_coordinator_pin`, `set_instance_status`, `set_restrict_executors` |
| M4 | `backup_database`, `force_unlock`, `export_package_json`, `import_package_json` |

См. [docs/DESKTOP-FILLER-TZ.md](../../docs/DESKTOP-FILLER-TZ.md), [docs/DESKTOP-TAURI-PILOT.md](../../docs/DESKTOP-TAURI-PILOT.md).
