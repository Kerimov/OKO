import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  setPortalPublicDir,
  closePackage,
  createPackageInFolder,
  exportPackageJson,
  getOsUserName,
  importJsonPackage,
  listPackageInstances,
  openPackageFolder,
  savePackageInstance,
  seedEmptyPackage,
  getSession,
  getPackageRulesInfo,
  getPackageInstance,
  loadAllPackageInstances,
  setPackageInstanceStatus,
  loadSchemaFromDisk,
  loadCatalogFromDisk,
  readPublicJson,
} from "./db/packageDb.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveDataRoot(): string {
  if (app.isPackaged) {
    return path.join(__dirname, "../dist");
  }
  return path.resolve(__dirname, "../../../portal/public");
}

function resolvePreloadPath(): string {
  const candidates = ["preload.cjs", "preload.js", "preload.mjs"];
  for (const name of candidates) {
    const p = path.join(__dirname, name);
    if (fs.existsSync(p)) return p;
  }
  return path.join(__dirname, "preload.js");
}

function registerIpc(): void {
  ipcMain.handle("oko:getUserName", () => getOsUserName());

  ipcMain.handle("oko:pickFolder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Выберите папку комплекта",
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("oko:pickJsonFile", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
      title: "Импорт комплекта JSON",
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("oko:openPackage", async (_e, folderPath: string) => openPackageFolder(folderPath));

  ipcMain.handle(
    "oko:createPackage",
    async (
      _e,
      payload: {
        folderPath: string;
        zid: number;
        eid: number;
        organization: string;
        periodStart: string;
        periodEnd: string;
        enterpriseCode: string;
      }
    ) =>
      createPackageInFolder(payload.folderPath, {
        zid: payload.zid,
        eid: payload.eid,
        organization: payload.organization,
        periodStart: payload.periodStart,
        periodEnd: payload.periodEnd,
        enterpriseCode: payload.enterpriseCode,
      })
  );

  ipcMain.handle("oko:seedPackage", () => {
    const s = getSession();
    if (!s) throw new Error("Комплект не открыт");
    return seedEmptyPackage(s.db, s.meta);
  });

  ipcMain.handle("oko:importJson", async (_e, folderPath: string, jsonPath: string) => {
    const raw = fs.readFileSync(jsonPath, "utf8");
    const pkg = JSON.parse(raw);
    if (!pkg.instances?.length) throw new Error("Некорректный JSON комплекта");
    return importJsonPackage(folderPath, pkg);
  });

  ipcMain.handle("oko:closePackage", () => {
    closePackage();
    return true;
  });

  ipcMain.handle("oko:getSessionInfo", () => {
    const s = getSession();
    if (!s) return null;
    let rulesSync = { exportedAt: null as string | null, fromPackage: false, hasChecks: false };
    try {
      rulesSync = getPackageRulesInfo();
    } catch {
      /* ignore */
    }
    return {
      folderPath: s.folderPath,
      meta: s.meta,
      instanceCount: listPackageInstances().length,
      rulesSync,
    };
  });

  ipcMain.handle("oko:listInstances", () => listPackageInstances());

  ipcMain.handle("oko:loadInstance", (_e, instanceId: string) => {
    const inst = getPackageInstance(instanceId);
    if (!inst) throw new Error("Форма не найдена");
    return inst;
  });

  ipcMain.handle("oko:loadAllInstances", () => loadAllPackageInstances());

  ipcMain.handle(
    "oko:setInstanceStatus",
    (_e, instanceId: string, status: "draft" | "submitted") =>
      setPackageInstanceStatus(instanceId, status)
  );

  ipcMain.handle("oko:loadSchema", (_e, formId: string) => loadSchemaFromDisk(formId));

  ipcMain.handle("oko:loadCatalog", () => loadCatalogFromDisk());

  ipcMain.handle("oko:readPublicJson", (_e, relativePath: string) =>
    readPublicJson(relativePath)
  );

  ipcMain.handle(
    "oko:saveInstance",
    (_e, inst: import("@portal/types").OkoFormInstance, userName?: string) =>
      savePackageInstance(inst, userName)
  );

  ipcMain.handle("oko:exportJson", async () => {
    const pkg = exportPackageJson();
    const s = getSession();
    const exportsDir = path.join(s!.folderPath, "exports");
    fs.mkdirSync(exportsDir, { recursive: true });
    const org = (pkg.organization || "oko").replace(/[^\wа-яА-ЯёЁ.-]+/gi, "_").slice(0, 30);
    const period = (pkg.periodEnd || pkg.periodStart || "report").replace(/\D/g, "").slice(0, 8);
    const fileName = `oko_package_${org}_${period || "report"}.json`;
    const filePath = path.join(exportsDir, fileName);
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        { ...pkg, exportedAt: new Date().toISOString(), instanceCount: pkg.instances.length },
        null,
        2
      ),
      "utf8"
    );
    return { filePath, fileName };
  });

  ipcMain.handle("oko:saveExportAs", async () => {
    const pkg = exportPackageJson();
    const result = await dialog.showSaveDialog({
      title: "Сохранить JSON для ЦО",
      defaultPath: "oko_package.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(
      result.filePath,
      JSON.stringify(
        { ...pkg, exportedAt: new Date().toISOString(), instanceCount: pkg.instances.length },
        null,
        2
      ),
      "utf8"
    );
    return result.filePath;
  });
}

function createWindow(): void {
  const preloadPath = resolvePreloadPath();
  if (!fs.existsSync(preloadPath)) {
    dialog.showErrorBox("ОКО Заполнение", `Не найден preload:\n${preloadPath}`);
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "ОКО Заполнение",
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    dialog.showErrorBox("ОКО Заполнение", `Не удалось загрузить интерфейс:\n${desc}\n${url}`);
  });

  win.webContents.on("preload-error", (_e, path, error) => {
    console.error("preload-error", path, error);
    dialog.showErrorBox("ОКО Заполнение", `Ошибка preload:\n${error.message}`);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexPath = path.join(__dirname, "../dist/index.html");
    if (!fs.existsSync(indexPath)) {
      dialog.showErrorBox("ОКО Заполнение", `Не найден интерфейс:\n${indexPath}`);
      return;
    }
    void win.loadFile(indexPath);
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  setPortalPublicDir(resolveDataRoot());
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  closePackage();
  if (process.platform !== "darwin") app.quit();
});
