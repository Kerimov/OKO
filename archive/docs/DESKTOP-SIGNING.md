# Подпись установщиков (опционально)

По умолчанию пилотные сборки **не подписаны** (`signingIdentity` / `certificateThumbprint` = null).  
Это закрывает выкладку без корпоративных сертификатов (TЗ M5: «подпись — отдельный этап»).

## Когда появятся сертификаты

### macOS

1. Установить Developer ID Application в связку ключей.
2. В `desktop/tauri/src-tauri/tauri.conf.json` → `bundle.macOS.signingIdentity` указать имя identity  
   либо `export APPLE_SIGNING_IDENTITY="Developer ID Application: …"`.
3. Для нотаризации: `APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID`.
4. `npm run build:tauri:dmg`

### Windows

1. Получить Authenticode-сертификат (.pfx).
2. `bundle.windows.certificateThumbprint` = отпечаток  
   или env `TAURI_SIGNING_PRIVATE_KEY` / пароль по документации Tauri 2.
3. `npm run build:tauri:nsis` на Windows-агенте / CI `windows-nsis`.

CI: `.github/workflows/tauri-ci.yml` собирает **несigning** NSIS и AppImage как артефакты.
