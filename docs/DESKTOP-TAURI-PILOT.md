# ОКО Заполнение (Tauri) — пилот M5

Целевой десктоп: `desktop/tauri` (M1–M4 функционал + этот документ для пилота в дочке).

Electron `desktop/filler` остаётся запасным пилотом до полной выкладки установщиков.

---

## Сборка установщиков

Требования: Node 22+, Rust stable, Xcode CLT (macOS) / VS Build Tools (Windows).

```bash
cd desktop/tauri
npm ci
npm run build:tauri          # текущая ОС → bundle
npm run build:tauri:dmg      # macOS .dmg / .app
# на Windows-агенте:
npm run build:tauri:nsis     # .exe (NSIS)
```

Артефакты: `desktop/tauri/src-tauri/target/release/bundle/`.

Оценка размера (ТЗ ≤ 30 МБ для установщика): проверяйте фактический `.dmg` / `.msi` после сборки; debug-сборки больше release.

Подпись кода / нотаризация Apple — отдельный этап (сертификаты организации).

---

## Пилот в дочке (чеклист)

1. Расшарить папку комплекта по SMB (один `oko.db`, WAL).
2. Установить «ОКО Заполнение» на 2–10 рабочих мест.
3. Разные имена пользователей; открыть **один и тот же** комплект.
4. **Acceptance §15.1–2:** разные ячейки видны ≤ 5 с; занятая ячейка не берётся вторым.
5. Координатор: PIN → назначения → «Мои формы» / restrict.
6. Бэкап БД → экспорт JSON → импорт в портал ЦО (§15.3, §15.5).
7. Нагрузка без GUI: см. скрипт ниже (10 клиентов).

Индикатор «Нет доступа к папке» (§15.4): sync-бар показывает `offline` при ошибках I/O; после восстановления polling продолжается.

---

## Нагрузочный smoke (SMB / локальный диск)

Симулирует N клиентов на одном `oko.db` (claim + запись ячеек):

```bash
# пакет должен содержать oko.db с хотя бы одной формой
python3 scripts/tauri-collab-smoke.py /path/to/package --clients 10 --seconds 20
```

Ожидание: `PASS`, `writes >= clients`, допускаются счётчики `busy` при конкуренции.

Прогон на реальном SMB: укажите путь вида `/Volumes/Share/OKO-пакет` (macOS) или `\\\\server\\share\\...` (если доступен из Python).

---

## Документы

| Документ | Назначение |
|----------|------------|
| [DESKTOP-FILLER-TZ.md](DESKTOP-FILLER-TZ.md) | ТЗ M1–M5 |
| [DESKTOP-TAURI-GAP-CHECKLIST.md](DESKTOP-TAURI-GAP-CHECKLIST.md) | Приоритеты закрытия дыр до приёмки §15 |
| [../desktop/tauri/README.md](../desktop/tauri/README.md) | Команды и API |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Общая локальная среда |

---

## Известные ограничения пилота

- Ручная приёмка §15 на SMB / 2 ПК и импорт в портал — см. [DESKTOP-TAURI-GAP-CHECKLIST.md](DESKTOP-TAURI-GAP-CHECKLIST.md).
- Windows NSIS и Linux-бандлы — на целевой ОС.
- Нет нотаризации / корпоративного Code Signing в CI по умолчанию.

Автопроверка:

```bash
./scripts/acceptance-desktop.sh /path/to/package
# включает smoke + --conflict-test (§15.2 / kontr *)
```

Установка macOS:

```bash
./scripts/install-macos-oko.sh desktop/tauri/src-tauri/target/release/bundle/dmg/*.dmg
```
