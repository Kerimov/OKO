#!/usr/bin/env bash
# Backup PostgreSQL from docker-compose.prod.yml
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${OKO_ENV_FILE:-.env.prod}"
COMPOSE_FILE="${OKO_COMPOSE_FILE:-docker-compose.prod.yml}"
OUT_DIR="${OKO_BACKUP_DIR:-$ROOT/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

mkdir -p "$OUT_DIR"
OUT_FILE="$OUT_DIR/oko-pg-$STAMP.sql.gz"

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-oko}" -d "${POSTGRES_DB:-oko}" --no-owner --no-acl \
  | gzip > "$OUT_FILE"

echo "Backup: $OUT_FILE"
