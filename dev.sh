#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDS_FILE="${ROOT_DIR}/.oko-dev-pids"
LOG_DIR="${ROOT_DIR}/.oko-logs"
DETACH=0
if [[ "${1:-}" == "--detach" || "${1:-}" == "-d" ]]; then
  DETACH=1
fi

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

# Load repo .env so DATABASE_URL / PORT are available to child processes
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

cleanup() {
  if [[ -f "${PIDS_FILE}" ]]; then
    while IFS= read -r pid; do
      [[ -n "${pid}" ]] || continue
      kill "${pid}" >/dev/null 2>&1 || true
      pkill -P "${pid}" >/dev/null 2>&1 || true
    done < "${PIDS_FILE}"
    rm -f "${PIDS_FILE}" || true
  fi
}

run_service() {
  local name="$1"
  local dir="$2"
  local cmd="$3"
  local log="${LOG_DIR}/$(echo "${name}" | tr '[:upper:]' '[:lower:]').log"

  echo "==> ${name}: starting (log: ${log})"
  mkdir -p "${LOG_DIR}"
  cd "${ROOT_DIR}/${dir}"

  if [[ ! -d node_modules ]]; then
    echo "==> ${name}: installing deps (npm ci)"
    npm ci
  fi

  nohup bash -c "${cmd}" >"${log}" 2>&1 &
  local pid=$!
  echo "${pid}" >> "${PIDS_FILE}"
  echo "==> ${name}: pid ${pid}"
}

# PostgreSQL required for API. Local Docker URL → always ensure compose postgres is up.
ensure_local_postgres() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: Docker not found. Start Postgres yourself or install Docker Desktop." >&2
    exit 1
  fi
  echo "==> Postgres: docker compose up -d postgres"
  (cd "${ROOT_DIR}" && docker compose up -d postgres) || {
    echo "ERROR: could not start postgres" >&2
    exit 1
  }
  echo "==> Postgres: waiting until ready…"
  for _ in $(seq 1 30); do
    if (cd "${ROOT_DIR}" && docker compose exec -T postgres pg_isready -U oko -d oko) >/dev/null 2>&1; then
      echo "==> Postgres: ready"
      return 0
    fi
    sleep 1
  done
  echo "ERROR: postgres did not become ready in time" >&2
  exit 1
}

if [[ -z "${DATABASE_URL:-}" ]]; then
  ensure_local_postgres
  PG_HOST_PORT="${POSTGRES_PORT:-5432}"
  export DATABASE_URL="postgresql://oko:oko@localhost:${PG_HOST_PORT}/oko"
  export DATABASE_SSL="${DATABASE_SSL:-false}"
elif [[ "${DATABASE_URL}" == *"localhost"* || "${DATABASE_URL}" == *"127.0.0.1"* ]]; then
  # .env already has DATABASE_URL (e.g. :5433) — still start the compose DB
  ensure_local_postgres
  export DATABASE_SSL="${DATABASE_SSL:-false}"
fi

if [[ -f "${PIDS_FILE}" ]]; then
  echo "==> stopping previous stack from ${PIDS_FILE}"
  cleanup
fi
rm -f "${PIDS_FILE}"
mkdir -p "${LOG_DIR}"

echo "==> API runtime: NestJS"
run_service "API" "server-nest" "npm run dev"
run_service "Portal" "portal" "npm run dev"

echo ""
echo "API:     http://localhost:3001"
echo "Swagger: http://localhost:3001/api/docs"
echo "Portal:  http://localhost:5173"
echo "DB:      PostgreSQL"
echo "Logs:    ${LOG_DIR}/"
echo ""

if [[ "${DETACH}" -eq 1 ]]; then
  echo "Detached. Stop later with: kill \$(cat ${PIDS_FILE}) or restart ./dev.sh --detach"
else
  echo "Press Ctrl+C to stop (or use --detach)."
  trap cleanup EXIT INT TERM
  wait
fi
