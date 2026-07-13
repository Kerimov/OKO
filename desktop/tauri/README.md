# OKO Заполнение — Tauri 2 (целевой десктоп)

Целевой стек по ТЗ: **Tauri 2 + React + rusqlite (WAL)**.  
Пилот на Electron остаётся в [`../filler`](../filler) до паритета.

## Первый срез (M1–M2)

- Открытие папки комплекта (`package.meta.json` + `oko.db`)
- Native SQLite через `rusqlite` (не sql.js)
- Список форм, загрузка / сохранение экземпляра
- Редактор на `FormTable` из portal
- Smoke `@oko/engine` в webview

Ещё не сделано: presence, auth, экспорт JSON, create/import package, полный паритет с Electron.

## Требования

- Node.js 22+
- [Rust](https://rustup.rs/) (stable)
- macOS: Xcode CLT · Windows: VS Build Tools · Linux: webkit2gtk

## Запуск

```bash
cd desktop/tauri
npm install
npm run dev:tauri
```

Только Vite (без окна): `npm run dev` → http://localhost:1420

## Команды Rust

| Command | Назначение |
|---------|------------|
| `runtime_info` | версия runtime |
| `open_package` | meta + открытие `oko.db` |
| `close_package` | сброс state |
| `list_summaries` | список форм комплекта |
| `load_instance` / `save_instance` | чтение и запись ячеек |

## Связь с Electron

| | Electron `filler` | Tauri (этот каталог) |
|--|-------------------|----------------------|
| Shell | Electron 35 | Tauri 2 |
| SQLite | sql.js (WASM) | rusqlite bundled |
| UI | React + `@portal` | React + `@portal` / `@oko/engine` |
| Статус | рабочий пилот | skeleton → паритет |

См. [docs/DESKTOP-FILLER-TZ.md](../../docs/DESKTOP-FILLER-TZ.md).
