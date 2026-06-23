#!/usr/bin/env bash
# Мини-сервер для OKO offline-kit (macOS / Linux, без Node.js если есть Python).
cd "$(dirname "$0")"
PORT=8787

if command -v python3 >/dev/null 2>&1; then
  echo "OKO Offline: http://localhost:$PORT"
  echo "Сервер ЦО не используется. Ctrl+C для остановки."
  (sleep 1 && (command -v xdg-open >/dev/null && xdg-open "http://localhost:$PORT" || open "http://localhost:$PORT" 2>/dev/null || true)) &
  exec python3 -m http.server "$PORT" --bind 127.0.0.1
fi

if command -v npx >/dev/null 2>&1; then
  echo "OKO Offline: http://localhost:$PORT (через npx serve)"
  npx --yes serve -l "$PORT" .
  exit $?
fi

echo "Установите Python 3 (рекомендуется) или Node.js: https://www.python.org"
exit 1
