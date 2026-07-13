#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDS_FILE="${ROOT_DIR}/.oko-dev-pids"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

need_cmd node
need_cmd npm

# Docker Desktop CLI is often missing from PATH until the shell is restarted
if ! command -v docker >/dev/null 2>&1; then
  if [[ -x /Applications/Docker.app/Contents/Resources/bin/docker ]]; then
    export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
  fi
fi

cleanup() {
  if [[ -f "${PIDS_FILE}" ]]; then
    while IFS= read -r pid; do
      [[ -n "${pid}" ]] || continue
      kill "${pid}" >/dev/null 2>&1 || true
    done < "${PIDS_FILE}"
    rm -f "${PIDS_FILE}" || true
  fi
}

trap cleanup EXIT INT TERM

run_service() {
  local name="$1"
  local dir="$2"
  local cmd="$3"

  echo "==> ${name}: starting"
  cd "${ROOT_DIR}/${dir}"

  if [[ ! -d node_modules ]]; then
    echo "==> ${name}: installing deps (npm ci)"
    npm ci
  fi

  # Start in background and remember PID
  bash -lc "${cmd}" &
  local pid=$!
  echo "${pid}" >> "${PIDS_FILE}"
  echo "==> ${name}: pid ${pid}"
}

# Prefer PostgreSQL. If DATABASE_URL is unset, start compose postgres when possible.
if [[ -z "${DATABASE_URL:-}" ]]; then
  if command -v docker >/dev/null 2>&1; then
    echo "==> DATABASE_URL unset — ensuring local Postgres (docker compose)"
    (cd "${ROOT_DIR}" && docker compose up -d postgres) || {
      echo "WARN: could not start postgres; API may fall back to SQLite" >&2
    }
    PG_HOST_PORT="${POSTGRES_PORT:-5432}"
    export DATABASE_URL="${DATABASE_URL:-postgresql://oko:oko@localhost:${PG_HOST_PORT}/oko}"
    export DATABASE_SSL="${DATABASE_SSL:-false}"
  else
    echo "WARN: DATABASE_URL unset and docker not found — API will use deprecated SQLite" >&2
    export OKO_ALLOW_SQLITE="${OKO_ALLOW_SQLITE:-1}"
  fi
fi

rm -f "${PIDS_FILE}"

# Default: NestJS. Legacy Express middleware-only shell: OKO_API_RUNTIME=express ./dev.sh
API_RUNTIME="${OKO_API_RUNTIME:-nest}"
if [[ "${API_RUNTIME}" == "express" ]]; then
  echo "==> API runtime: Express (legacy entrypoint — no REST handlers; prefer nest)"
  run_service "API" "server" "npm run dev"
else
  echo "==> API runtime: NestJS"
  run_service "API" "server-nest" "npm run dev"
fi
run_service "Portal" "portal" "npm run dev"

echo ""
echo "API:    http://localhost:3001  (runtime=${API_RUNTIME})"
echo "Swagger: http://localhost:3001/api/docs  (nest only)"
echo "Portal: http://localhost:5173"
if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "DB:     PostgreSQL (DATABASE_URL set)"
else
  echo "DB:     SQLite (deprecated for API)"
fi
echo ""
echo "Press Ctrl+C to stop."

wait

