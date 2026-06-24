import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { runPackageFormChecks } from "./db/checkRunner.js";
import { runDbTask } from "./db/dbQueue.js";
import {
  listCellChangesSince,
  saveSingleCell,
} from "./db/cellSyncDb.js";
import {
  claimCellPresence,
  heartbeatPresence,
  listInstancePresence,
  listPackageEditors,
  pruneStalePresence,
  releaseClientPresence,
  forceUnlockCell,
} from "./db/presenceDb.js";
import {
  countPackageRecalcRules,
  countPackageRashRules,
  getPackageFormRuleCounts,
  getPackageKontrAgents,
  runPackageRashChecks,
  runPackageRecalc,
} from "./db/formEngineRunner.js";
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
  getCollaborationSettings,
  getMachineName,
  requireSessionDb,
  getPackageCompleteness,
} from "./db/packageDb.js";
import {
  hasCoordinatorPin,
  verifyCoordinatorPin,
  setCoordinatorPin,
} from "./db/coordinatorPin.js";
import {
  readAssignments,
  writeAssignments,
  listKnownAssignees,
  type AssignmentItem,
} from "./db/assignments.js";
import { backupPackageDatabase } from "./db/backupDb.js";
import { PACKAGE_META } from "./db/schema.js";
import {
  authCreateInitialAdmin,
  authCreateUser,
  authDeleteUser,
  getAuthSession,
  authListActiveLogins,
  authListUsers,
  authLogin,
  authLogout,
  authNeedsSetup,
  authResetPassword,
  authUpdateUser,
  type UserRole,
} from "./db/usersAuth.js";

const appClientId = randomUUID();

function assertCoordinatorAccess(pin: string | undefined): void {
  const s = requireSessionDb();
  const metaPath = path.join(s.folderPath, PACKAGE_META);
  if (!hasCoordinatorPin(metaPath)) return;
  if (!pin || !verifyCoordinatorPin(s.folderPath, pin)) {
    throw new Error("Неверный PIN координатора");
  }
}

function buildExportWarnings(): string[] {
  const c = getPackageCompleteness();
  const warnings: string[] = [];
  const missing = c.items.filter((i) => !i.filled);
  if (missing.length > 0) {
    warnings.push(`Не заведено форм: ${missing.length} (${missing.slice(0, 5).map((m) => m.formId).join(", ")}${missing.length > 5 ? "…" : ""})`);
  }
  const notSubmitted = c.items.filter((i) => i.filled && i.status !== "submitted");
  if (notSubmitted.length > 0) {
    warnings.push(`Не отмечено готовыми: ${notSubmitted.length} форм`);
  }
  return warnings;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function mainLogPath(): string {
  try {
    return path.join(app.getPath("userData"), "logs", "main.log");
  } catch {
    return path.join(os.tmpdir(), "oko-filler-main.log");
  }
}

function logMain(level: "info" | "warn" | "error", message: string): void {
  try {
    const p = mainLogPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, `${new Date().toISOString()}\t${level}\t${message}\n`, "utf8");
  } catch {
    /* ignore */
  }
}

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
  ipcMain.handle("oko:getUserName", () => {
    const auth = getAuthSession();
    if (auth) return auth.displayName;
    return getOsUserName();
  });
  ipcMain.handle("oko:getClientId", () => appClientId);
  ipcMain.handle("oko:getCollaborationSettings", () => getCollaborationSettings());

  ipcMain.handle("oko:authNeedsSetup", () => authNeedsSetup());
  ipcMain.handle("oko:authGetSession", () => getAuthSession());
  ipcMain.handle("oko:authLogin", (_e, login: string, password: string) =>
    authLogin(login, password)
  );
  ipcMain.handle(
    "oko:authCreateInitialAdmin",
    (_e, login: string, displayName: string, password: string) =>
      authCreateInitialAdmin(login, displayName, password)
  );
  ipcMain.handle("oko:authLogout", () => {
    authLogout();
    return true;
  });
  ipcMain.handle("oko:authListUsers", () => authListUsers());
  ipcMain.handle("oko:authListActiveLogins", () => authListActiveLogins());
  ipcMain.handle(
    "oko:authCreateUser",
    (
      _e,
      payload: { login: string; displayName: string; password: string; role: UserRole }
    ) => authCreateUser(payload)
  );
  ipcMain.handle(
    "oko:authUpdateUser",
    (
      _e,
      payload: { id: string; displayName?: string; role?: UserRole; active?: boolean }
    ) => authUpdateUser(payload)
  );
  ipcMain.handle("oko:authResetPassword", (_e, userId: string, password: string) =>
    authResetPassword(userId, password)
  );
  ipcMain.handle("oko:authDeleteUser", (_e, userId: string) => authDeleteUser(userId));

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
    const s = getSession();
    if (s) releaseClientPresence(s.db, appClientId);
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
      hasCoordinatorPin: hasCoordinatorPin(path.join(s.folderPath, PACKAGE_META)),
      restrictExecutorsToAssignments:
        s.meta.settings?.restrictExecutorsToAssignments ?? false,
    };
  });

  ipcMain.handle("oko:listInstances", () => listPackageInstances());

  ipcMain.handle("oko:loadInstance", (_e, instanceId: string) =>
    runDbTask(() => {
      const inst = getPackageInstance(instanceId);
      if (!inst) throw new Error("Форма не найдена");
      return inst;
    })
  );

  ipcMain.handle("oko:loadAllInstances", () => runDbTask(() => loadAllPackageInstances()));

  ipcMain.handle(
    "oko:setInstanceStatus",
    (_e, instanceId: string, status: "draft" | "submitted") =>
      runDbTask(() => setPackageInstanceStatus(instanceId, status))
  );

  ipcMain.handle("oko:loadSchema", (_e, formId: string) => loadSchemaFromDisk(formId));

  ipcMain.handle("oko:loadCatalog", () => loadCatalogFromDisk());

  ipcMain.handle("oko:readPublicJson", (_e, relativePath: string) =>
    readPublicJson(relativePath)
  );

  ipcMain.handle(
    "oko:runFormChecks",
    (
      _e,
      formId: string,
      live?: { instanceId: string; rows: import("@portal/types").RowData[] }
    ) => runDbTask(() => runPackageFormChecks(formId, live))
  );

  ipcMain.handle("oko:runRashChecks", (_e, formId: string, rows: import("@portal/types").RowData[]) =>
    runDbTask(() => runPackageRashChecks(formId, rows))
  );

  ipcMain.handle("oko:recalcForm", (_e, formId: string, rows: import("@portal/types").RowData[]) =>
    runDbTask(() => runPackageRecalc(formId, rows))
  );

  ipcMain.handle("oko:getFormRuleCounts", (_e, formId: string) =>
    getPackageFormRuleCounts(formId)
  );

  ipcMain.handle("oko:getKontrAgents", () => getPackageKontrAgents());

  ipcMain.handle(
    "oko:saveInstance",
    (_e, inst: import("@portal/types").OkoFormInstance, userName?: string) =>
      runDbTask(() => savePackageInstance(inst, userName, appClientId))
  );

  ipcMain.handle("oko:saveInstanceJson", async (_e, fileName: string, content: string) => {
    const result = await dialog.showSaveDialog({
      title: "Экспорт формы JSON",
      defaultPath: fileName,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return false;
    fs.writeFileSync(result.filePath, content, "utf8");
    return true;
  });

  ipcMain.handle("oko:saveExcelFile", async (_e, fileName: string, base64: string) => {
    const result = await dialog.showSaveDialog({
      title: "Сохранить Excel",
      defaultPath: fileName,
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (result.canceled || !result.filePath) return false;
    fs.writeFileSync(result.filePath, Buffer.from(base64, "base64"));
    return true;
  });

  ipcMain.handle("oko:log", async (_e, level: string, message: string) => {
    try {
      const s = getSession();
      const baseDir = s
        ? path.join(s.folderPath, ".oko", "logs")
        : path.join(app.getPath("userData"), "logs");
      fs.mkdirSync(baseDir, { recursive: true });
      const filePath = path.join(baseDir, "renderer.log");
      const line = `${new Date().toISOString()}\t${level}\t${message}\n`;
      fs.appendFileSync(filePath, line, "utf8");
    } catch {
      /* ignore */
    }
    return true;
  });

  ipcMain.handle("oko:exportJson", async (_e, opts?: { pin?: string; actor?: string }) => {
    return runDbTask(() => {
      assertCoordinatorAccess(opts?.pin);
      const pkg = exportPackageJson();
      const s = requireSessionDb();
      const warnings = buildExportWarnings();
      const exportsDir = path.join(s.folderPath, "exports");
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
      s.db.prepare(
        `INSERT INTO local_audit (action, instance_id, row_no, column_key, actor, details, created_at)
         VALUES ('export_json', NULL, NULL, NULL, ?, ?, ?)`
      ).run(opts?.actor ?? getOsUserName(), filePath, new Date().toISOString());
      return { filePath, fileName, warnings };
    });
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

  ipcMain.handle(
    "oko:claimCell",
    (
      _e,
      payload: {
        instanceId: string;
        rowNo: number;
        columnKey: string;
        userName: string;
      }
    ) =>
      runDbTask(() => {
        const s = requireSessionDb();
        const cfg = getCollaborationSettings();
        pruneStalePresence(s.db, cfg.presenceStaleSec);
        return claimCellPresence(s.db, {
          ...payload,
          machineName: getMachineName(),
          clientId: appClientId,
          staleSec: cfg.presenceStaleSec,
        });
      })
  );

  ipcMain.handle(
    "oko:releasePresence",
    () =>
      runDbTask(() => {
        const s = getSession();
        if (s) releaseClientPresence(s.db, appClientId);
        return true;
      })
  );

  ipcMain.handle(
    "oko:heartbeatCell",
    (
      _e,
      payload: { instanceId: string; rowNo: number; columnKey: string }
    ) =>
      runDbTask(() => {
        const s = requireSessionDb();
        return heartbeatPresence(s.db, { ...payload, clientId: appClientId });
      })
  );

  ipcMain.handle("oko:listInstancePresence", (_e, instanceId: string) =>
    runDbTask(() => {
      const s = requireSessionDb();
      const cfg = getCollaborationSettings();
      pruneStalePresence(s.db, cfg.presenceStaleSec);
      return listInstancePresence(s.db, instanceId, appClientId, cfg.presenceStaleSec);
    })
  );

  ipcMain.handle("oko:listPackageEditors", () =>
    runDbTask(() => {
      const s = requireSessionDb();
      const cfg = getCollaborationSettings();
      pruneStalePresence(s.db, cfg.presenceStaleSec);
      const map = listPackageEditors(s.db, cfg.presenceStaleSec);
      return Object.fromEntries(map.entries());
    })
  );

  ipcMain.handle(
    "oko:listCellChanges",
    (_e, instanceId: string, sinceIso: string) =>
      runDbTask(() => {
        const s = requireSessionDb();
        return listCellChangesSince(s.db, instanceId, sinceIso);
      })
  );

  ipcMain.handle(
    "oko:saveCell",
    (
      _e,
      payload: {
        instanceId: string;
        rowNo: number;
        rowName: string | null;
        columnKey: string;
        value: string | number | undefined;
        userName: string;
      }
    ) =>
      runDbTask(() => {
        const s = requireSessionDb();
        const updatedAt = saveSingleCell(s.db, {
          instanceId: payload.instanceId,
          rowNo: payload.rowNo,
          rowName: payload.rowName,
          columnKey: payload.columnKey,
          value: payload.value,
          updatedBy: payload.userName,
          clientId: appClientId,
        });
        return { updatedAt };
      })
  );

  ipcMain.handle(
    "oko:forceUnlock",
    (
      _e,
      payload: {
        instanceId: string;
        rowNo?: number;
        columnKey?: string;
        actor: string;
        pin?: string;
      }
    ) =>
      runDbTask(() => {
        assertCoordinatorAccess(payload.pin);
        const s = requireSessionDb();
        return forceUnlockCell(s.db, payload);
      })
  );

  ipcMain.handle("oko:hasCoordinatorPin", () => {
    const s = getSession();
    if (!s) return false;
    return hasCoordinatorPin(path.join(s.folderPath, PACKAGE_META));
  });

  ipcMain.handle("oko:verifyCoordinatorPin", (_e, pin: string) => {
    const s = getSession();
    if (!s) return false;
    const metaPath = path.join(s.folderPath, PACKAGE_META);
    if (!hasCoordinatorPin(metaPath)) return true;
    return verifyCoordinatorPin(s.folderPath, pin);
  });

  ipcMain.handle(
    "oko:setCoordinatorPin",
    (_e, payload: { pin: string; oldPin?: string }) => {
      const s = requireSessionDb();
      setCoordinatorPin(s.folderPath, payload.pin, payload.oldPin);
      return true;
    }
  );

  ipcMain.handle("oko:getCompleteness", () => runDbTask(() => getPackageCompleteness()));

  ipcMain.handle("oko:getAssignments", () => {
    const s = requireSessionDb();
    return readAssignments(s.folderPath);
  });

  ipcMain.handle("oko:saveAssignments", (_e, items: AssignmentItem[]) => {
    const s = requireSessionDb();
    return writeAssignments(s.folderPath, items);
  });

  ipcMain.handle("oko:listKnownAssignees", () => {
    const s = requireSessionDb();
    const fromPkg = listKnownAssignees(s.folderPath);
    const fromAuth = authListActiveLogins();
    return [...new Set([...fromAuth, ...fromPkg])].sort((a, b) =>
      a.localeCompare(b, "ru")
    );
  });

  ipcMain.handle("oko:backupDatabase", (_e, payload?: { pin?: string; actor?: string }) =>
    runDbTask(() => {
      assertCoordinatorAccess(payload?.pin);
      const s = requireSessionDb();
      const dest = backupPackageDatabase(
        s.folderPath,
        s.db,
        payload?.actor ?? getOsUserName()
      );
      return { filePath: dest };
    })
  );
}

function createWindow(): void {
  const preloadPath = resolvePreloadPath();
  if (!fs.existsSync(preloadPath)) {
    dialog.showErrorBox("ОКО Заполнение", `Не найден preload:\n${preloadPath}`);
  }

  logMain("info", "app start");
  logMain("info", `log file: ${mainLogPath()}`);

  const win = new BrowserWindow({
    width: 1440,
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
    logMain("error", `did-fail-load code=${code} desc=${desc} url=${url}`);
    dialog.showErrorBox(
      "ОКО Заполнение",
      `Не удалось загрузить интерфейс:\n${desc}\n${url}\n\nЛог:\n${mainLogPath()}`
    );
  });

  win.webContents.on("preload-error", (_e, path, error) => {
    logMain("error", `preload-error path=${path} err=${error?.message ?? String(error)}`);
    console.error("preload-error", path, error);
    dialog.showErrorBox(
      "ОКО Заполнение",
      `Ошибка preload:\n${error.message}\n\nЛог:\n${mainLogPath()}`
    );
  });

  win.webContents.on("render-process-gone", (_e, details) => {
    logMain(
      "error",
      `render-process-gone reason=${details.reason} exitCode=${details.exitCode}`
    );
    dialog.showErrorBox(
      "ОКО Заполнение",
      `Интерфейс приложения аварийно завершился.\nСмотрите лог:\n${mainLogPath()}`
    );
  });

  win.on("unresponsive", () => {
    logMain("warn", "window unresponsive");
  });

  win.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    const lvl = level >= 3 ? "error" : level === 2 ? "warn" : "info";
    logMain(lvl, `console ${sourceId}:${line} ${message}`);
  });

  win.webContents.on("will-navigate", (event, url) => {
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    const allowed = devUrl ? [devUrl, "devtools://"] : ["file://"];
    if (!allowed.some((prefix) => url.startsWith(prefix))) {
      event.preventDefault();
    }
  });

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexPath = path.join(__dirname, "../dist/index.html");
    if (!fs.existsSync(indexPath)) {
      logMain("error", `index.html not found: ${indexPath}`);
      dialog.showErrorBox(
        "ОКО Заполнение",
        `Не найден интерфейс:\n${indexPath}\n\nЛог:\n${mainLogPath()}`
      );
      return;
    }
    logMain("info", `loading ui: ${indexPath}`);
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
