#!/usr/bin/env node
/**
 * Упаковывает dist-offline в portal/public/offline-kit-template.zip
 * (без offline-package.json — подставляется в браузере при скачивании).
 *
 * Запуск: cd portal && npm run build:offline-template
 */
import { createRequire } from "module";
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../portal/package.json"));
const JSZip = require("jszip");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORTAL = join(ROOT, "portal");
const DIST = join(PORTAL, "dist-offline");
const OUT = join(PORTAL, "public", "offline-kit-template.zip");

const README = `OKO Offline — заполнение форм без доступа к серверу
====================================================

1. Запустите:
   - Windows: start.bat
   - macOS / Linux: ./start.sh  (или: bash start.sh)

2. Откройте в браузере: http://localhost:8787

3. Заполните формы в «Мои формы».

4. Раздел «Отправить в ЦО» → «Сохранить комплект JSON».

5. Отправьте JSON-файл в центральный офис.

Требования: Node.js 18+ (для локального сервера npx serve).
`;

const START_SH = `#!/usr/bin/env bash
cd "$(dirname "$0")"
if ! command -v npx >/dev/null 2>&1; then
  echo "Установите Node.js: https://nodejs.org"
  exit 1
fi
echo "OKO Offline: http://localhost:8787"
npx --yes serve -l 8787 .
`;

const START_BAT = `@echo off
cd /d "%~dp0"
where npx >nul 2>&1 || (echo Установите Node.js: https://nodejs.org & pause & exit /b 1)
echo OKO Offline: http://localhost:8787
npx --yes serve -l 8787 .
`;

function addDir(zip, dirPath, basePath = dirPath) {
  for (const name of readdirSync(dirPath)) {
    const full = join(dirPath, name);
    const rel = relative(basePath, full).replace(/\\/g, "/");
    if (statSync(full).isDirectory()) {
      addDir(zip, full, basePath);
    } else {
      zip.file(rel, readFileSync(full));
    }
  }
}

if (!existsSync(DIST)) {
  console.error("Нет portal/dist-offline — сначала: npm run build:offline-template");
  process.exit(1);
}

const zip = new JSZip();
addDir(zip, DIST);
zip.file("README.txt", README);
zip.file("start.sh", START_SH);
zip.file("start.bat", START_BAT);

const buf = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 6 },
});

writeFileSync(OUT, buf);
console.log(`Шаблон offline-kit: ${OUT} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
