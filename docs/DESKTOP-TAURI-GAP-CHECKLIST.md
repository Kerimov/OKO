# ОКО Заполнение (Tauri) — чеклист закрытия ТЗ

Опора: [DESKTOP-FILLER-TZ.md](DESKTOP-FILLER-TZ.md) §11–15, [DESKTOP-TAURI-PILOT.md](DESKTOP-TAURI-PILOT.md).  
Цель: довести пилот до формулировки «закрыто по ТЗ M1–M5 + приёмка §15».

Легенда: `[ ]` открыто · `[~]` частично · `[x]` сделано.

---

## P0 — блокер пилота в дочке

| # | Пункт ТЗ | Работа | Готово |
|---|----------|--------|--------|
| P0.1 | §15.1–2 | Ручной тест на **2 ПК / SMB** | [ ] авто: `--conflict-test` в smoke [x] |
| P0.2 | §15.4 | Потеря SMB → `offline`, resync | [ ] (UI есть; нужен SMB-стенд) |
| P0.3 | §15.5 | PIN → force-unlock + backup перед экспортом | [ ] (код есть; нужен прогон) |
| P0.4 | §15.3 | Экспорт JSON → импорт в портал ЦО | [ ] (экспорт **v1.2 + rules** [x]) |
| P0.5 | §2 Win | NSIS на Windows-агенте | [ ] |
| P0.6 | M4 / §8.3 | recalc + rash в bridge | [x] |

```bash
./scripts/acceptance-desktop.sh /path/to/package
./scripts/install-macos-oko.sh path/to/*.dmg
```

**Windows NSIS:** только на Win + VS Build Tools: `npm run build:tauri:nsis`.

---

## P1 — функционал

| # | Пункт | Готово |
|---|-------|--------|
| P1.1 | Имя из ОС | [x] |
| P1.2 | kontr `*` row lock | [x] |
| P1.3 | recalc + конфликт-тост | [x] |
| P1.4 | недавние комплекты | [x] |
| P1.5 | бэкап + warnings экспорта | [x] |
| P1.6 | `ready`/`accepted` → `submitted` в API | [x] |
| P1.7 | import overwrite/skip | [x] |
| P1.8 | UI presence / «В комплекте» | [x] |

---

## P2 — нефункционалка

| # | Пункт | Готово |
|---|-------|--------|
| P2.1 | Linux bundle | [ ] |
| P2.2 | логи APPDATA/Library | [x] |
| P2.3 | `.oko/schema_version` | [x] |
| P2.4 | размер ≤ 30 МБ | [~] macOS ок |
| P2.5 | code signing | [ ] |
| P2.6 | экспорт `rules` v1.2 | [x] |

---

## P3 — косметика / CI

| # | Работа | Готово |
|---|--------|--------|
| P3.1 | title кириллица; productName ASCII (DMG) | [x] |
| P3.2 | `scripts/install-macos-oko.sh` | [x] |
| P3.3 | упростить local auth | [ ] согласование |
| P3.4 | CI `tauri-ci` (frontend + smoke) | [x] |

---

## Осталось только на стенде

1. SMB + 2 клиента (P0.1–P0.3)  
2. Импорт выгрузки в портал (P0.4)  
3. Windows NSIS (P0.5) и при необходимости Linux (P2.1)  
4. Подпись / нотаризация (P2.5)
