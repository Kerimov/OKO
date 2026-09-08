#!/usr/bin/env bash
# One-shot local start: Postgres + Nest API + portal.
# Usage:
#   ./start.sh           # foreground (Ctrl+C stops)
#   ./start.sh --detach  # background
#   ./start.sh --stop    # stop previously started stack
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDS_FILE="${ROOT_DIR}/.oko-dev-pids"
LOG_DIR="${ROOT_DIR}/.oko-logs"
DETACH=0
DO_STOP=0
OPEN_BROWSER=1

for arg in "$@"; do
  case "${arg}" in
    --detach|-d) DETACH=1 ;;
    --stop) DO_STOP=1 ;;
    --no-browser) OPEN_BROWSER=0 ;;
    -h|--help)
      echo "Usage: ./start.sh [--detach|-d] [--stop] [--no-browser]"
      exit 0
      ;;
    *)
      echo "Unknown option: ${arg}" >&2
      echo "Usage: ./start.sh [--detach|-d] [--stop] [--no-browser]" >&2
      exit 1
      ;;
  esac
done

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
      pkill -P "${pid}" >/dev/null 2>&1 || true
    done < "${PIDS_FILE}"
    rm -f "${PIDS_FILE}" || true
  fi
}

if [[ "${DO_STOP}" -eq 1 ]]; then
  echo "==> Stopping OKO stack"
  cleanup
  echo "==> Stopped"
  exit 0
fi

# First-run .env
if [[ ! -f "${ROOT_DIR}/.env" ]]; then
  if [[ -f "${ROOT_DIR}/.env.example" ]]; then
    cp "${ROOT_DIR}/.env.example" "${ROOT_DIR}/.env"
    echo "==> Created .env from .env.example"
  else
    echo "ERROR: no .env and no .env.example" >&2
    exit 1
  fi
fi

set -a
# shellcheck disable=SC1091
source "${ROOT_DIR}/.env"
set +a

ensure_npm() {
  local dir="$1"
  local label="$2"
  if [[ ! -d "${ROOT_DIR}/${dir}/node_modules" ]]; then
    echo "==> ${label}: installing deps"
    if [[ -f "${ROOT_DIR}/${dir}/package-lock.json" ]]; then
      (cd "${ROOT_DIR}/${dir}" && npm ci)
    else
      (cd "${ROOT_DIR}/${dir}" && npm install)
    fi
  fi
}

run_service() {
  local name="$1"
  local dir="$2"
  local cmd="$3"
  local log="${LOG_DIR}/$(echo "${name}" | tr '[:upper:]' '[:lower:]').log"

  echo "==> ${name}: starting (log: ${log})"
  mkdir -p "${LOG_DIR}"
  ensure_npm "${dir}" "${name}"
  cd "${ROOT_DIR}/${dir}"
  nohup bash -c "${cmd}" >"${log}" 2>&1 &
  local pid=$!
  echo "${pid}" >> "${PIDS_FILE}"
  echo "==> ${name}: pid ${pid}"
}

ensure_local_postgres() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: Docker not found. Start Postgres yourself or install Docker Desktop." >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    if [[ -d /Applications/Docker.app ]]; then
      echo "==> Docker Desktop: launching…"
      open -a Docker
      for _ in $(seq 1 60); do
        docker info >/dev/null 2>&1 && break
        sleep 2
      done
    fi
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "ERROR: Docker daemon is not running." >&2
    exit 1
  fi
  echo "==> Postgres: docker compose up -d postgres"
  (cd "${ROOT_DIR}" && docker compose up -d postgres) || {
    echo "ERROR: could not start postgres" >&2
    exit 1
  }
  echo "==> Postgres: waiting until ready…"
  for _ in $(seq 1 45); do
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
  ensure_local_postgres
  export DATABASE_SSL="${DATABASE_SSL:-false}"
fi

if [[ -f "${PIDS_FILE}" ]]; then
  echo "==> stopping previous stack from ${PIDS_FILE}"
  cleanup
fi
rm -f "${PIDS_FILE}"
mkdir -p "${LOG_DIR}"

# Shared packages / domain before API (file: deps)
ensure_npm "packages/engine" "engine"
ensure_npm "packages/spreadsheet" "spreadsheet"
ensure_npm "web/domain" "domain"

echo "==> API runtime: NestJS"
run_service "API" "web/api" "npm run dev"
run_service "Portal" "web/portal" "npm run dev"

PORTAL_URL="http://localhost:5173"
API_URL="http://localhost:${PORT:-3001}"

echo ""
echo "API:     ${API_URL}"
echo "Swagger: ${API_URL}/api/docs"
echo "Portal:  ${PORTAL_URL}"
echo "Logs:    ${LOG_DIR}/"
echo "Stop:    ./start.sh --stop"
echo ""

# Wait until portal answers, then open browser
if [[ "${OPEN_BROWSER}" -eq 1 ]]; then
  echo "==> Waiting for portal…"
  for _ in $(seq 1 60); do
    if curl -sf "${PORTAL_URL}" >/dev/null 2>&1; then
      if command -v open >/dev/null 2>&1; then
        open "${PORTAL_URL}" >/dev/null 2>&1 || true
      fi
      break
    fi
    sleep 1
  done
fi

if [[ "${DETACH}" -eq 1 ]]; then
  echo "Detached. Stop with: ./start.sh --stop"
else
  echo "Press Ctrl+C to stop (or use --detach / ./start.sh --stop)."
  trap cleanup EXIT INT TERM
  wait
fi
