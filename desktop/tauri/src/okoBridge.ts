/**
 * Bridge: installs window.oko compatible with Electron filler UI,
 * backed by Tauri invoke commands + browser fetch for public assets.
 */
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  formsUsedByFormChecks,
  runFormChecksWithData,
  type CheckRule,
  type CheckRunResult,
} from "@oko/engine";
import type {
  InstanceSummary,
  OkoFormInstance,
  PackageCompleteness,
  RowData,
} from "@portal/types";
import { buildInitialRows } from "@portal/utils";
import type { OkoDesktopApi } from "./desktopApi";
import {
  getPackageFormRuleCounts,
  getPackageKontrAgents,
  loadCatalog,
  loadSchema,
  runPackageRashChecks,
  runPackageRecalc,
} from "./formEngine";
import type { AuthUser, OpenPackageResult, PublicUser, SessionInfo, UserRole } from "./types";

type TauriOpen = {
  folderPath: string;
  meta: SessionInfo["meta"] & {
    enterpriseCode?: string;
    settings?: { restrictExecutorsToAssignments?: boolean };
    coordinatorPinHash?: string;
  };
  dbPath: string;
  instances: number;
  hasCoordinatorPin: boolean;
  restrictExecutorsToAssignments: boolean;
};

let lastSession: SessionInfo | null = null;

function toOpenResult(r: TauriOpen): OpenPackageResult {
  const meta = {
    formatVersion: r.meta.formatVersion,
    zid: r.meta.zid,
    eid: r.meta.eid,
    organization: r.meta.organization,
    periodStart: r.meta.periodStart,
    periodEnd: r.meta.periodEnd,
    enterpriseCode: r.meta.enterpriseCode ?? "1@1",
    createdAt: r.meta.createdAt ?? new Date().toISOString(),
  };
  lastSession = {
    folderPath: r.folderPath,
    meta,
    instanceCount: r.instances,
    hasCoordinatorPin: r.hasCoordinatorPin,
    restrictExecutorsToAssignments: r.restrictExecutorsToAssignments,
    rulesSync: {
      exportedAt: null,
      fromPackage: false,
      hasChecks: true,
      hasRash: true,
    },
  };
  rememberRecent(r.folderPath);
  return { folderPath: r.folderPath, meta, instanceCount: r.instances };
}

const AUTH_KEY = "oko-tauri-auth-users";
const SESSION_KEY = "oko-tauri-auth-session";
const RECENT_KEY = "oko-tauri-recent-packages";
const MAX_RECENT = 8;

function loadUsers(): PublicUser[] {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) || "[]") as PublicUser[];
  } catch {
    return [];
  }
}

function saveUsers(users: PublicUser[]) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(users));
}

function getSessionUser(): AuthUser | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null") as AuthUser | null;
  } catch {
    return null;
  }
}

function setSessionUser(user: AuthUser | null) {
  if (!user) localStorage.removeItem(SESSION_KEY);
  else localStorage.setItem(SESSION_KEY, JSON.stringify(user));
}

function rememberRecent(folderPath: string) {
  const path = folderPath.trim();
  if (!path) return;
  let list: string[] = [];
  try {
    list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") as string[];
  } catch {
    list = [];
  }
  list = [path, ...list.filter((p) => p !== path)].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

export function listRecentPackages(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") as string[];
  } catch {
    return [];
  }
}

async function loadRulesBundle(): Promise<Record<string, unknown>> {
  const fetchOne = async (path: string) => {
    try {
      const res = await fetch(`/${path}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };
  const [checks, rash, recalc, rowFormulas, kontr] = await Promise.all([
    fetchOne("data/checks.json"),
    fetchOne("data/rash-rules.json"),
    fetchOne("data/recalc-rules.json"),
    fetchOne("data/row-formulas.json"),
    fetchOne("data/kontr.json"),
  ]);
  const kontrItems =
    kontr && typeof kontr === "object"
      ? ((kontr as { items?: unknown; agents?: unknown }).items ??
        (kontr as { agents?: unknown }).agents ??
        kontr)
      : [];
  return {
    exportedAt: new Date().toISOString(),
    ...(checks ? { checks } : {}),
    ...(rash ? { rash } : {}),
    ...(recalc ? { recalc } : {}),
    ...(rowFormulas ? { rowFormulas } : {}),
    kontr: { items: Array.isArray(kontrItems) ? kontrItems : [] },
  };
}

async function buildExportWarnings(): Promise<string[]> {
  const warnings: string[] = [];
  try {
    const [catalog, summaries, completeness] = await Promise.all([
      loadCatalog(),
      invoke<InstanceSummary[]>("list_summaries"),
      computeCompleteness(),
    ]);
    const empty = catalog.forms.length - summaries.length;
    if (empty > 0) {
      warnings.push(`Не создано экземпляров форм: ${empty} из ${catalog.forms.length}.`);
    }
    if (completeness.draft > 0) {
      warnings.push(`Форм в черновике (не сдано): ${completeness.draft}.`);
    }
    const unfilled = completeness.items.filter((i) => !i.filled).length;
    if (unfilled > 0) {
      warnings.push(`Форм без данных в комплекте: ${unfilled}.`);
    }
  } catch {
    /* ignore */
  }
  return warnings;
}

async function computeCompleteness(): Promise<PackageCompleteness> {
  const session = lastSession;
  if (!session) throw new Error("Комплект не открыт");
  const [catalog, summaries] = await Promise.all([loadCatalog(), invoke<InstanceSummary[]>("list_summaries")]);
  const byTemplate = new Map(summaries.map((s) => [s.templateId, s]));
  let filled = 0;
  let draft = 0;
  let submitted = 0;
  const items = catalog.forms.map((form) => {
    const s = byTemplate.get(form.id);
    const status = (s?.status as "draft" | "submitted" | undefined) ?? undefined;
    if (s) {
      filled++;
      if (status === "submitted") submitted++;
      else draft++;
    }
    return {
      formId: form.id,
      title: form.title,
      category: form.category,
      filled: Boolean(s),
      instanceId: s?.instanceId,
      displayName: s?.displayName,
      status,
    };
  });
  return {
    zid: session.meta.zid,
    eid: session.meta.eid,
    total: catalog.forms.length,
    filled,
    draft,
    submitted,
    items,
  };
}

function createApi(): OkoDesktopApi {
  return {
    getUserName: async () => {
      const session = getSessionUser()?.displayName;
      if (session) return session;
      try {
        return await invoke<string>("get_os_user_name");
      } catch {
        return "Оператор";
      }
    },
    getClientId: async () => invoke<string>("get_client_id"),
    authNeedsSetup: async () => loadUsers().length === 0,
    authGetSession: async () => getSessionUser(),
    authLogin: async (login, password) => {
      const users = loadUsers();
      const u = users.find((x) => x.login === login && (x as PublicUser & { password?: string }).active !== false);
      // passwords stored separately
      const pwKey = `oko-tauri-pw:${login}`;
      const stored = localStorage.getItem(pwKey);
      if (!u || stored !== password) throw new Error("Неверный логин или пароль");
      const session: AuthUser = {
        id: u.id,
        login: u.login,
        displayName: u.displayName,
        role: u.role,
      };
      setSessionUser(session);
      return session;
    },
    authCreateInitialAdmin: async (login, displayName, password) => {
      if (loadUsers().length > 0) throw new Error("Пользователи уже созданы");
      const now = new Date().toISOString();
      const user: PublicUser = {
        id: crypto.randomUUID(),
        login,
        displayName,
        role: "admin",
        active: true,
        createdAt: now,
        updatedAt: now,
      };
      saveUsers([user]);
      localStorage.setItem(`oko-tauri-pw:${login}`, password);
      const session: AuthUser = {
        id: user.id,
        login: user.login,
        displayName: user.displayName,
        role: user.role,
      };
      setSessionUser(session);
      return session;
    },
    authLogout: async () => {
      setSessionUser(null);
      return true;
    },
    authListUsers: async () => loadUsers(),
    authListActiveLogins: async () => {
      const s = getSessionUser();
      return s ? [s.login] : [];
    },
    authCreateUser: async (payload) => {
      const users = loadUsers();
      if (users.some((u) => u.login === payload.login)) throw new Error("Логин занят");
      const now = new Date().toISOString();
      const user: PublicUser = {
        id: crypto.randomUUID(),
        login: payload.login,
        displayName: payload.displayName,
        role: payload.role,
        active: true,
        createdAt: now,
        updatedAt: now,
      };
      users.push(user);
      saveUsers(users);
      localStorage.setItem(`oko-tauri-pw:${payload.login}`, payload.password);
      return user;
    },
    authUpdateUser: async (payload) => {
      const users = loadUsers();
      const idx = users.findIndex((u) => u.id === payload.id);
      if (idx < 0) throw new Error("Пользователь не найден");
      const next = {
        ...users[idx],
        displayName: payload.displayName ?? users[idx].displayName,
        role: (payload.role as UserRole) ?? users[idx].role,
        active: payload.active ?? users[idx].active,
        updatedAt: new Date().toISOString(),
      };
      users[idx] = next;
      saveUsers(users);
      return next;
    },
    authResetPassword: async (userId, password) => {
      const u = loadUsers().find((x) => x.id === userId);
      if (!u) throw new Error("Пользователь не найден");
      localStorage.setItem(`oko-tauri-pw:${u.login}`, password);
      return true;
    },
    authDeleteUser: async (userId) => {
      const users = loadUsers().filter((u) => u.id !== userId);
      saveUsers(users);
      return true;
    },
    getCollaborationSettings: async () => {
      try {
        return await invoke("get_collaboration_settings");
      } catch {
        return { heartbeatIntervalSec: 5, presenceStaleSec: 30, syncPollIntervalSec: 3 };
      }
    },
    pickFolder: async () => {
      const selected = await open({ directory: true, multiple: false, title: "Папка комплекта ОКО" });
      if (Array.isArray(selected)) return selected[0] ?? null;
      return selected;
    },
    pickJsonFile: async () => {
      const selected = await open({
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
        title: "Файл комплекта JSON",
      });
      if (Array.isArray(selected)) return selected[0] ?? null;
      return selected;
    },
    openPackage: async (folderPath) => {
      const r = await invoke<TauriOpen>("open_package", { folderPath });
      return toOpenResult(r);
    },
    createPackage: async (payload) => {
      const r = await invoke<TauriOpen>("create_empty_package", {
        folderPath: payload.folderPath,
        zid: payload.zid,
        eid: payload.eid,
        organization: payload.organization,
        periodStart: payload.periodStart,
        periodEnd: payload.periodEnd,
        enterpriseCode: payload.enterpriseCode,
      });
      return toOpenResult(r);
    },
    seedPackage: async () => {
      if (!lastSession) throw new Error("Комплект не открыт");
      const catalog = await loadCatalog();
      const existing = await invoke<InstanceSummary[]>("list_summaries");
      const have = new Set(existing.map((s) => s.templateId));
      let created = 0;
      const meta = lastSession.meta;
      for (const form of catalog.forms) {
        if (have.has(form.id)) continue;
        const schema = await loadSchema(form.id);
        const signatures: Record<string, string> = {};
        for (const name of schema.signatures) signatures[name] = "";
        const now = new Date().toISOString();
        const inst: OkoFormInstance = {
          instanceId: crypto.randomUUID(),
          templateId: schema.id,
          templateTitle: schema.title,
          displayName: `${schema.id} — ${schema.title}`,
          zid: meta.zid,
          eid: meta.eid,
          meta: {
            organization: meta.organization,
            enterpriseCode: meta.enterpriseCode,
            periodStart: meta.periodStart,
            periodEnd: meta.periodEnd,
            unit: schema.meta?.unit || "тыс.руб.",
          },
          rows: buildInitialRows(schema),
          signatures,
          status: "draft",
          createdAt: now,
          updatedAt: now,
        };
        await invoke("save_instance", { inst });
        created++;
      }
      if (lastSession) lastSession.instanceCount += created;
      return { created };
    },
    importJson: async (folderPath, jsonPath, mode) => {
      const raw = await invoke<string>("read_text_file", { path: jsonPath });
      const pkg = JSON.parse(raw) as {
        organization?: string;
        periodStart?: string;
        periodEnd?: string;
        zid?: number;
        eid?: number;
        instances?: Array<{ meta?: { enterpriseCode?: string } }>;
      };
      try {
        const opened = await invoke<TauriOpen>("open_package", { folderPath });
        toOpenResult(opened);
      } catch {
        const r = await invoke<TauriOpen>("create_empty_package", {
          folderPath,
          zid: pkg.zid ?? 1,
          eid: pkg.eid ?? 1,
          organization: pkg.organization || "Организация",
          periodStart: pkg.periodStart || "",
          periodEnd: pkg.periodEnd || "",
          enterpriseCode: pkg.instances?.[0]?.meta?.enterpriseCode || "1@1",
        });
        toOpenResult(r);
      }
      await invoke("import_package_json", {
        filePath: jsonPath,
        actor: getSessionUser()?.displayName || "Оператор",
        pin: null,
        mode: mode === "skip" ? "skip" : "overwrite",
      });
      const again = await invoke<TauriOpen>("open_package", { folderPath });
      return toOpenResult(again);
    },
    closePackage: async () => {
      lastSession = null;
      return invoke("close_package");
    },
    getSessionInfo: async () => lastSession,
    listInstances: async () => invoke("list_summaries"),
    loadInstance: async (instanceId) => invoke("load_instance", { instanceId }),
    loadAllInstances: async () => {
      const summaries = await invoke<InstanceSummary[]>("list_summaries");
      const out: OkoFormInstance[] = [];
      for (const s of summaries) {
        out.push(await invoke("load_instance", { instanceId: s.instanceId }));
      }
      return out;
    },
    setInstanceStatus: async (instanceId, status) =>
      invoke("set_instance_status", { instanceId, status }),
    loadSchema,
    loadCatalog,
    readPublicJson: async (relativePath) => {
      const res = await fetch(`/${relativePath.replace(/^\//, "")}`);
      if (!res.ok) throw new Error(`Не найден ${relativePath}`);
      return res.json();
    },
    runFormChecks: async (formId, live) => {
      const data = await fetch("/data/checks.json").then((r) => (r.ok ? r.json() : { checks: [] }));
      const checks = (
        Array.isArray(data.checks) ? data.checks : Array.isArray(data) ? data : []
      ) as CheckRule[];
      const needed = formsUsedByFormChecks(checks, formId, "period");
      const summaries = await invoke<InstanceSummary[]>("list_summaries");
      const instances: OkoFormInstance[] = [];
      for (const s of summaries) {
        if (!needed.has(s.templateId)) continue;
        const inst = await invoke<OkoFormInstance>("load_instance", { instanceId: s.instanceId });
        if (live && inst.instanceId === live.instanceId) {
          instances.push({ ...inst, rows: live.rows });
        } else {
          instances.push(inst);
        }
      }
      if (live && !instances.some((i) => i.instanceId === live.instanceId)) {
        const cur = await invoke<OkoFormInstance>("load_instance", { instanceId: live.instanceId });
        instances.push({ ...cur, rows: live.rows });
      }
      return runFormChecksWithData(checks, formId, instances, "period") as CheckRunResult;
    },
    runRashChecks: async (formId, rows, rashEntries) =>
      runPackageRashChecks(formId, rows, rashEntries ?? []),
    recalcForm: async (formId, rows) => runPackageRecalc(formId, rows),
    getFormRuleCounts: async (formId) => getPackageFormRuleCounts(formId),
    getKontrAgents: async () => getPackageKontrAgents(),
    saveInstance: async (inst) => invoke("save_instance", { inst }),
    saveInstanceJson: async (fileName, content) => {
      const path = await save({
        defaultPath: fileName,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return false;
      await invoke("write_text_file", { path, content });
      return true;
    },
    saveExcelFile: async (fileName, base64) => {
      const path = await save({
        defaultPath: fileName,
        filters: [{ name: "Excel", extensions: ["xlsx"] }],
      });
      if (!path) return false;
      const binary = atob(base64);
      const bytes = Array.from(binary, (c) => c.charCodeAt(0));
      await invoke("write_bytes_file", { path, bytes });
      return true;
    },
    exportJson: async (opts) => {
      const warnings = await buildExportWarnings();
      const filePath = await invoke<string>("export_package_json", {
        actor: opts?.actor || getSessionUser()?.displayName || "Оператор",
        pin: opts?.pin ?? null,
      });
      try {
        const raw = await invoke<string>("read_text_file", { path: filePath });
        const pkg = JSON.parse(raw) as Record<string, unknown>;
        pkg.version = "1.2";
        pkg.rules = await loadRulesBundle();
        await invoke("write_text_file", {
          path: filePath,
          content: `${JSON.stringify(pkg, null, 2)}\n`,
        });
      } catch {
        /* keep file without rules if enrichment fails */
      }
      const fileName = filePath.split(/[/\\]/).pop() || "export.json";
      return { filePath, fileName, warnings };
    },
    saveExportAs: async () => {
      const exported = await invoke<string>("export_package_json", {
        actor: getSessionUser()?.displayName || "Оператор",
        pin: null,
      });
      const dest = await save({
        defaultPath: exported.split(/[/\\]/).pop() || "oko_package.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!dest) return null;
      if (dest !== exported) {
        await invoke("copy_file", { from: exported, to: dest });
      }
      return dest;
    },
    log: async (level, message) => {
      try {
        await invoke("append_app_log", { level, message });
      } catch {
        /* ignore */
      }
      return true;
    },
    claimCell: async (payload) => invoke("claim_cell", payload),
    releasePresence: async () => invoke("release_presence"),
    heartbeatCell: async (payload) => invoke("heartbeat_cell", payload),
    listInstancePresence: async (instanceId) =>
      invoke("list_instance_presence", { instanceId }),
    listPackageEditors: async () => invoke("list_package_editors"),
    listCellChanges: async (instanceId, sinceIso) =>
      invoke("list_cell_changes", { instanceId, sinceIso }),
    saveCell: async (payload) =>
      invoke("save_cell", {
        instanceId: payload.instanceId,
        rowNo: payload.rowNo,
        rowName: payload.rowName,
        columnKey: payload.columnKey,
        value: payload.value ?? "",
        userName: payload.userName,
      }),
    forceUnlock: async (payload) =>
      invoke("force_unlock", {
        instanceId: payload.instanceId,
        actor: payload.actor,
        pin: payload.pin ?? null,
        rowNo: payload.rowNo ?? null,
        columnKey: payload.columnKey ?? null,
      }),
    hasCoordinatorPin: async () => {
      try {
        return await invoke<boolean>("has_coordinator_pin");
      } catch {
        return Boolean(lastSession?.hasCoordinatorPin);
      }
    },
    verifyCoordinatorPin: async (pin) => invoke("verify_coordinator_pin", { pin }),
    setCoordinatorPin: async (payload) =>
      invoke("set_coordinator_pin", { pin: payload.pin, oldPin: payload.oldPin ?? null }),
    getCompleteness: computeCompleteness,
    getAssignments: async () => invoke("get_assignments"),
    saveAssignments: async (items) => invoke("save_assignments", { items }),
    listKnownAssignees: async () => invoke("list_known_assignees"),
    backupDatabase: async (payload) => {
      const filePath = await invoke<string>("backup_database", {
        actor: payload?.actor || getSessionUser()?.displayName || "Оператор",
        pin: payload?.pin ?? null,
      });
      return { filePath };
    },
  };
}

export function installOkoBridge(): void {
  (window as unknown as { oko: OkoDesktopApi }).oko = createApi();
}
