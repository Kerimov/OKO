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

echo "== collab smoke (10 clients) =="
python3 "$ROOT/scripts/tauri-collab-smoke.py" "$PKG" --clients 10 --seconds 20

echo "== schema_version =="
if [[ -f "$PKG/.oko/schema_version" ]]; then
  echo "OK: $(cat "$PKG/.oko/schema_version")"
else
  echo "WARN: .oko/schema_version missing (открыть комплект в приложении один раз)"
fi

echo
echo "Manual remaining (§15):"
echo "  1) 2 ПК + SMB: разные ячейки ≤5с; занятая не берётся"
echo "  2) отключить сеть к папке → «Нет доступа к папке» → resync"
echo "  3) PIN: force-unlock + backup + export → импорт в портал"
echo "  4) Windows: npm run build:tauri:nsis на Win-агенте"
