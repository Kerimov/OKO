#!/usr/bin/env bash
# Сборка offline-kit для дочерней организации (без доступа к серверу).
#
# Использование:
#   ./scripts/build-offline-kit.sh path/to/oko_package_Org_2026.json
#
# Результат: dist/oko-offline-kit.zip — распаковать на ПК дочки и запустить start.sh / start.bat

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE_JSON="${1:-}"

if [[ -z "$PACKAGE_JSON" || ! -f "$PACKAGE_JSON" ]]; then
  echo "Укажите JSON-комплект, выгруженный из ЦО (Сводка и импорт → Выгрузить комплект для дочки)."
  echo "Пример: ./scripts/build-offline-kit.sh ./oko_package_Дочка_20260331.json"
  exit 1
fi

STAGING="$ROOT/.offline-kit-staging"
rm -rf "$STAGING"
mkdir -p "$STAGING"

cp "$PACKAGE_JSON" "$ROOT/portal/public/offline-package.json"

echo "→ Сборка портала (offline)…"
cd "$ROOT/portal"
VITE_OFFLINE_KIT=true npm run build

cp -R dist/* "$STAGING/"

cat > "$STAGING/README.txt" << 'EOF'
OKO Offline — заполнение форм без доступа к серверу
====================================================

1. Запустите:
   - Windows: start.bat
   - macOS / Linux: ./start.sh  (или: bash start.sh)

2. Откроется браузер: http://localhost:8787

3. Заполните формы в «Мои формы».

4. Раздел «Отправить в ЦО» → «Сохранить комплект JSON».

5. Отправьте JSON-файл в центральный офис.

Требования: Node.js 18+ (для локального сервера).
EOF

cat > "$STAGING/start.sh" << 'EOF'
#!/usr/bin/env bash
cd "$(dirname "$0")"
if ! command -v npx >/dev/null 2>&1; then
  echo "Установите Node.js: https://nodejs.org"
  exit 1
fi
echo "OKO Offline: http://localhost:8787"
npx --yes serve -l 8787 .
EOF
chmod +x "$STAGING/start.sh"

cat > "$STAGING/start.bat" << 'EOF'
@echo off
cd /d "%~dp0"
where npx >nul 2>&1 || (echo Установите Node.js: https://nodejs.org & pause & exit /b 1)
echo OKO Offline: http://localhost:8787
npx --yes serve -l 8787 .
EOF

OUT_ZIP="$ROOT/dist/oko-offline-kit.zip"
mkdir -p "$ROOT/dist"
rm -f "$OUT_ZIP"
(cd "$STAGING" && zip -r "$OUT_ZIP" .)

rm -rf "$STAGING"
# Оставляем offline-package.json в public для dev; в git не коммитится seed

echo ""
echo "Готово: $OUT_ZIP"
echo "Передайте zip-архив дочерней организации."
