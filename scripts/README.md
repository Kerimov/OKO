# scripts/

Operational and CI utilities kept at the repo root.

| Script | Role |
|--------|------|
| `api_journey.mjs` | API e2e journey (CI) |
| `validate_corpus.py` | Corpus size/key checks (`web/portal/public/data`) |
| `scan_secrets.py` | Lightweight secrets scan |
| `tauri_security_smoke.py` | Tauri CSP / allowlist smoke |
| `tauri-collab-smoke.py` | Desktop collab smoke |
| `acceptance-desktop.sh` | Desktop acceptance wrapper |
| `acceptance-tz-remaining.py` | TZ remaining checks |
| `pg-backup.sh` / `prod-up.sh` | Ops helpers |
| `install-macos-oko.sh` | macOS install helper |
| `import_production_rash.sh` | Re-export rash data from production MDB |

One-off Access/MDB explorers and schema generators live in [`archive/scripts/`](../archive/scripts/).
