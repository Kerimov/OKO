#!/usr/bin/env bash
# Start OKO production stack (PostgreSQL + API + nginx portal)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${OKO_ENV_FILE:-.env.prod}"
COMPOSE_FILE="${OKO_COMPOSE_FILE:-docker-compose.prod.yml}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy from .env.prod.example:" >&2
  echo "  cp .env.prod.example .env.prod" >&2
  exit 1
fi

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build "$@"

echo ""
echo "OKO production stack started."
echo "  Portal: http://localhost:$(grep -E '^OKO_HTTP_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 || echo 8080)"
echo "  Health: curl -s http://localhost:.../api/health"
echo ""
echo "Logs: docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs -f"
