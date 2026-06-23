/**
 * Сборка с Authenticode-подписью (electron-builder).
 * Читает desktop/filler/.env.signing
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const envFile = path.join(root, ".env.signing");

function loadSigningEnv() {
  if (!fs.existsSync(envFile)) {
    console.error(
      "Не найден .env.signing\n" +
        "  1. copy .env.signing.example .env.signing\n" +
        "  2. powershell -ExecutionPolicy Bypass -File scripts/create-signing-cert.ps1\n" +
        "  3. npm run dist:signed"
    );
    process.exit(1);
  }

  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key === "CSC_LINK" && !path.isAbsolute(val)) {
      val = path.resolve(root, val);
    }
    process.env[key] = val;
  }

  if (!process.env.CSC_LINK && !process.env.WIN_CSC_LINK) {
    console.error(".env.signing: укажите CSC_LINK или WIN_CSC_LINK");
    process.exit(1);
  }
  if (process.env.CSC_LINK && !fs.existsSync(process.env.CSC_LINK)) {
    console.error(`Сертификат не найден: ${process.env.CSC_LINK}`);
    process.exit(1);
  }
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function signPortableArtifact() {
  const installerDir = path.join(root, "installer");
  if (!fs.existsSync(installerDir)) return;

  const portable = fs
    .readdirSync(installerDir)
    .filter((n) => /^OKO-Zapolnenie-.*\.exe$/i.test(n))
    .map((n) => path.join(installerDir, n))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];

  if (!portable) return;

  const signScript = path.join(root, "scripts", "sign-windows.ps1");
  run("powershell", [
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    signScript,
    "-Files",
    portable,
  ]);
}

loadSigningEnv();
delete process.env.CSC_IDENTITY_AUTO_DISCOVERY;

const nsis = process.argv.includes("--nsis");
const builderArgs = nsis ? ["--win", "nsis"] : ["--win", "portable"];

console.log("Сборка с подписью:", process.env.CSC_LINK || process.env.WIN_CSC_LINK);
run("node", ["scripts/kill-and-clean-release.mjs"]);
run("npm", ["run", "build"]);
run("npx", ["electron-builder", ...builderArgs]);
if (!nsis) {
  signPortableArtifact();
} else {
  const installerDir = path.join(root, "installer");
  if (fs.existsSync(installerDir)) {
    const setup = fs
      .readdirSync(installerDir)
      .filter((n) => /Setup.*\.exe$/i.test(n))
      .map((n) => path.join(installerDir, n));
    if (setup.length) {
      const signScript = path.join(root, "scripts", "sign-windows.ps1");
      run("powershell", [
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        signScript,
        "-Files",
        ...setup,
      ]);
    }
  }
}
