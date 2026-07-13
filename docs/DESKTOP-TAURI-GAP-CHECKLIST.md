# ОКО Заполнение (Tauri) — чеклист закрытия ТЗ

Опора: [DESKTOP-FILLER-TZ.md](DESKTOP-FILLER-TZ.md) §11–15, [DESKTOP-TAURI-PILOT.md](DESKTOP-TAURI-PILOT.md).  
Цель: довести пилот до формулировки «закрыто по ТЗ M1–M5 + приёмка §15».

Легенда: `[ ]` открыто · `[~]` частично · `[x]` сделано.

---

## P0 — блокер пилота в дочке

| # | Пункт ТЗ | Работа | Готово |
|---|----------|--------|--------|
| P0.1 | §15.1–2 | Ручной тест на **2 ПК / SMB**: разные ячейки ≤ 5 с; занятая не берётся | [ ] |
| P0.2 | §15.4 | Потеря SMB → `offline`, после — resync | [ ] |
| P0.3 | §15.5 | PIN → force-unlock + backup перед экспортом | [ ] |
| P0.4 | §15.3 | Экспорт JSON → импорт в портал ЦО (76 форм) | [ ] |
| P0.5 | §2 Win | Сборка **NSIS** на **Windows-агенте** (`npm run build:tauri:nsis`) | [ ] |
| P0.6 | M4 / §8.3 | **recalc** + **rash** в bridge (`formEngine.ts`) | [x] |

Авточасть коллаба/нагрузки:

```bash
./scripts/acceptance-desktop.sh /path/to/package
```

**Windows NSIS (P0.5):** на macOS/Linux NSIS-бандл Windows не собирается. На машине с VS Build Tools:

```bash
cd desktop/tauri && npm ci && npm run build:tauri:nsis
```

---

## P1 — соответствие ТЗ по функционалу

| # | Пункт ТЗ | Работа | Готово |
|---|----------|--------|--------|
| P1.1 | §3 | Имя из ОС (`USERNAME`/`USER`) как fallback; collab через displayName | [x] |
| P1.2 | §6.4 | Контрагенты: claim с учётом `column_key = '*'` (строка целиком) | [x] |
| P1.3 | §7.4–7.5 | Recalc в bridge; конфликт чужой ячейки — подсветка + тост 3 с | [x] |
| P1.4 | §8.1 | Недавние комплекты (localStorage) | [x] |
| P1.5 | §8.5 | Предложение бэкапа + warnings при экспорте | [x] |
| P1.6 | §9–10 | Статусы: UI `draft`/`submitted` ↔ ТЗ `ready` (сдача = submitted) | [~] |
| P1.7 | §10 | Импорт JSON: диалог overwrite / skip по `templateId` | [x] |
| P1.8 | §8.3 | Панель «В комплекте» / presence — из Electron UI | [x] |

---

## P2 — нефункционалка и выкладка

| # | Пункт ТЗ | Работа | Готово |
|---|----------|--------|--------|
| P2.1 | §2 Linux | AppImage/deb на Linux-агенте | [ ] |
| P2.2 | §11 | Логи → APPDATA / Library/Logs / `.local/share` (`append_app_log`) | [x] |
| P2.3 | §11 | `.oko/schema_version` при open/create | [x] |
| P2.4 | §11 | Размер ≤ 30 МБ (macOS DMG ~5–6 МБ) | [~] |
| P2.5 | M5 | Code signing / нотаризация | [ ] |
| P2.6 | пилот | Экспорт `rules` v1.2 | [ ] |

---

## P3 — косметика

| # | Работа | Готово |
|---|--------|--------|
| P3.1 | displayName кириллица vs ASCII productName | [~] |
| P3.2 | Скрипт установки без двух `.app` в README | [ ] |
| P3.3 | Упростить local admin auth (согласование) | [ ] |
| P3.4 | CI артефакты | [ ] |

---

## Уже закрыто (база M1–M5)

- [x] M1–M5 каркас, UI parity Electron, Tauri 2 + rusqlite
- [x] P0.6 rash/recalc, P1.1–1.5/1.7–1.8, P2.2–2.3

---

## Осталось снаружи этой машины

1. P0.1–P0.4 на реальном SMB + портал  
2. P0.5 NSIS на Windows  
3. P2.1 Linux bundle, P2.5 подпись  

Вне scope §14 не планировать.
