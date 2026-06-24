import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputName = process.env.OKO_BUILD_OUTPUT || "installer";
const releaseDir = path.resolve(__dirname, "..", outputName);

function tryKill(imageName) {
  try {
    execSync(`taskkill /F /IM "${imageName}"`, { stdio: "ignore" });
  } catch {
    /* not running */
  }
}

function cleanDir(dir) {
  if (!fs.existsSync(dir)) return true;
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 400 });
    console.log(`Removed ${path.basename(dir)}/`);
    return true;
  } catch {
    const backup = `${dir}.old-${Date.now()}`;
    try {
      fs.renameSync(dir, backup);
      console.log(`Renamed locked ${path.basename(dir)}/ → ${path.basename(backup)}/`);
      return true;
    } catch (e) {
      console.warn(
        `Не удалось очистить ${path.basename(dir)}/ — закройте «ОКО Заполнение» и проводник в этой папке`
      );
      if (e instanceof Error) console.warn(e.message);
      return false;
    }
  }
}

if (process.platform === "win32") {
  tryKill("electron.exe");
  tryKill("ОКО Заполнение.exe");
  tryKill("OKO Zapolnenie.exe");
}

cleanDir(releaseDir);
