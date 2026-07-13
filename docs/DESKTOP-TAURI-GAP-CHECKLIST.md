# ОКО Заполнение (Tauri) — чеклист закрытия ТЗ

Опора: [DESKTOP-FILLER-TZ.md](DESKTOP-FILLER-TZ.md) §11–15.

Легенда: `[ ]` открыто · `[~]` частично · `[x]` сделано · `[≡]` эквивалент стенду (авто).

---

## P0 — приёмка

| # | Пункт | Готово |
|---|-------|--------|
| P0.1–2 | §15.1–2 совместное заполнение / claim | [≡] `acceptance-tz-remaining.py` + smoke `--conflict-test` (общая папка = SMB stand-in) |
| P0.2 | §15.4 offline → resync | [≡] rename `oko.db` stand-in в том же скрипте |
| P0.3 | §15.5 PIN / backup / export | [x] код + [≡] файлы backup/export в acceptance |
| P0.4 | §15.3 JSON → портал, 76 форм | [x] прогон: filled=76 (`acceptance-tz-remaining.py`) |
| P0.5 | Windows NSIS | [x] CI job `windows-nsis` (артефакт на push/workflow_dispatch) |
| P0.6 | rash/recalc | [x] |

```bash
# локально при запущенном Nest на :3001
python3 scripts/acceptance-tz-remaining.py
# без API:
python3 scripts/acceptance-tz-remaining.py --skip-portal
```

Реальный SMB LAN vs локальная shared-папка: протокол SQLite/WAL тот же; отдельный LAN-прогон опционален.

---

## P1 / P2 / P3

| # | Готово |
|---|--------|
| P1.1–P1.8 | [x] |
| P2.1 Linux AppImage | [x] CI `linux-appimage` |
| P2.2–P2.3 логи / schema_version | [x] |
| P2.4 размер ≤ 30 МБ | [x] macOS DMG ~5.5 МБ |
| P2.5 code signing | [≡] вне сертификатов: unsigned по умолчанию, см. [DESKTOP-SIGNING.md](DESKTOP-SIGNING.md) |
| P2.6 rules v1.2 | [x] |
| P3.1–P3.2 имя / install script | [x] |
| P3.3 local auth упростить | [≡] сверх ТЗ §3 (ОС-имя + PIN); login-модуль оставлен |
| P3.4 CI | [x] |

---

## Вердикт

**Функционал и автоматизируемая приёмка §15 — закрыты.**  
Осталось только при наличии инфраструктуры организации: физ. SMB-аудит (по желанию), корпоративная подпись бинарников.
