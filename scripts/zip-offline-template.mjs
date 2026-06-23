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

const README = `OKO Offline — заполнение форм без связи с центральным офисом
================================================================

1. Запустите:
   - Windows: start.bat  (дважды щёлкнуть)
   - macOS / Linux: ./start.sh

2. Откроется браузер: http://localhost:8787

3. Заполните формы в «Мои формы».

4. Раздел «Отправить в ЦО» → «Сохранить комплект JSON».

5. Отправьте JSON-файл в центральный офис.

Требования:
- Windows: встроенный PowerShell (Node.js НЕ нужен).
- macOS / Linux: Python 3 (обычно уже установлен) или Node.js.
- Интернет и сервер ЦО не нужны.
`;

const START_BAT = `@echo off
chcp 65001 >nul
cd /d "%~dp0"
title OKO Offline
start "OKO Offline Server" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
ping -n 3 127.0.0.1 >nul
start "" "http://localhost:8787/"
echo.
echo OKO Offline открыт в браузере.
echo Не закрывайте окно «OKO Offline Server» — пока оно открыто, портал работает.
echo.
pause
`;

const START_SH = `#!/usr/bin/env bash
cd "$(dirname "$0")"
exec bash ./serve.sh
`;

const SCRIPTS = join(ROOT, "scripts");


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
zip.file("start.bat", START_BAT);
zip.file("start.sh", START_SH);
zip.file("serve.ps1", readFileSync(join(SCRIPTS, "offline-serve.ps1")));
zip.file("serve.sh", readFileSync(join(SCRIPTS, "offline-serve.sh")));

const buf = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 6 },
});

writeFileSync(OUT, buf);
console.log(`Шаблон offline-kit: ${OUT} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
