import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const releaseDir = path.resolve(__dirname, "../installer");

function tryKill(imageName) {
  try {
    execSync(`taskkill /F /IM "${imageName}"`, { stdio: "ignore" });
  } catch {
    /* not running */
  }
}

if (process.platform === "win32") {
  tryKill("electron.exe");
  tryKill("ОКО Заполнение.exe");
}

if (fs.existsSync(releaseDir)) {
  try {
    fs.rmSync(releaseDir, { recursive: true, force: true });
    console.log("Removed installer/");
  } catch (e) {
    console.warn(
      "Не удалось удалить installer/ — закройте «ОКО Заполнение» и повторите npm run dist"
    );
    if (e instanceof Error) console.warn(e.message);
  }
}
