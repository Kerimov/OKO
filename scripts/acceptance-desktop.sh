#!/usr/bin/env bash
# Automated portion of DESKTOP-FILLER-TZ §15 + pilot checklist.
# Manual SMB/2-PC steps remain in docs/DESKTOP-TAURI-GAP-CHECKLIST.md (P0.1–P0.4).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="${1:-}"
if [[ -z "$PKG" || ! -f "$PKG/oko.db" ]]; then
  echo "Usage: $0 /path/to/package   # folder with oko.db"
  exit 1
fi

echo "== collab smoke (10 clients) + §15.2 claim =="
python3 "$ROOT/scripts/tauri-collab-smoke.py" "$PKG" --clients 10 --seconds 20 --conflict-test

echo "== schema_version =="
if [[ -f "$PKG/.oko/schema_version" ]]; then
  echo "OK: $(cat "$PKG/.oko/schema_version")"
else
  echo "WARN: .oko/schema_version missing (открыть комплект в приложении один раз)"
fi

echo
echo "== TZ remaining (local; portal if API up) =="
if curl -sf "$OKO_API_URL/api/health" >/dev/null 2>&1 || curl -sf http://localhost:3001/api/health >/dev/null 2>&1; then
  python3 "$ROOT/scripts/acceptance-tz-remaining.py" --forms "${OKO_ACCEPT_FORMS:-76}"
else
  python3 "$ROOT/scripts/acceptance-tz-remaining.py" --forms 10 --skip-portal
  echo "(portal skipped — start Nest for full §15.3)"
fi
