#!/usr/bin/env bash
# Импорт справочников расшифровок из боевой MDB в portal/public/data/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MDB="${OKO_MDB_PATH:-$ROOT/12345/z261.m_b}"

if [[ ! -f "$MDB" ]]; then
  echo "MDB not found: $MDB" >&2
  echo "Set OKO_MDB_PATH=/path/to/production.mdb" >&2
  exit 1
fi

export OKO_MDB_PATH="$MDB"
echo "Source MDB: $MDB"

python3 "$ROOT/scripts/export_rash_support_data.py"
python3 "$ROOT/scripts/export_row_rash_index.py"

echo ""
echo "Для сервера (после деплоя kontr.json):"
echo "  OKO_REIMPORT_KONTR_ON_START=1  — при старте"
echo "  POST /api/kontr/reimport        — вручную (admin)"
