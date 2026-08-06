import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { loadRashRules } from "../api";
import { canMutateData } from "../auth";
import {
  clearRashRefsCache,
  type RashRefItem,
  type RashRefsData,
} from "../engine/rashRefs";
import {
  applyRefsOverlay,
  emptyRefsOverlay,
  listRefDirectories,
  loadRefsOverlay,
  saveRefsOverlay,
  type RefsOverlayPackage,
  type UsedRefDirectory,
} from "../engine/refsOverlay";
import { isLoanNzsGroup } from "../engine/refsPackage";
import {
  validateClassifierItems,
  validateKontrDraftRow,
} from "../engine/refsValidation";
import { writeJsonSheetWorkbook, triggerBrowserDownload } from "../engine/excelWorkbook";
import {
  archiveKontrVersion,
  createKontrVersion,
  listKontrUsages,
  listKontrVersions,
  type KontrUsageHit,
  type KontrVersionDto,
} from "../psdApi";
import {
  bulkUpsertKontrAgents,
  isBackendMode,
  loadKontrAgents,
  reimportKontrAgents,
} from "../storage";
import type { KontrAgent, RashRule } from "../types";
import { useAuth } from "../useAuth";
import { LoadingSkeleton } from "../components/LoadingSkeleton";

type KontrDraft = {
  id: number | null;
  name: string;
  oldName: string;
  inn: string;
  kpp: string;
  orgType: string;
  idObdnsi: string;
  /** true for newly added rows not yet POSTed */
  isNew?: boolean;
  dirty?: boolean;
};

function agentToDraft(a: KontrAgent): KontrDraft {
  return {
    id: a.id,
    name: a.name ?? "",
    oldName: a.oldName ?? "",
    inn: a.inn ?? "",
    kpp: a.kpp ?? "",
    orgType: a.orgType == null ? "" : String(a.orgType),
    idObdnsi: a.idObdnsi ?? "",
    dirty: false,
  };
}

type DirFilter = "used" | "all" | "edited" | "technical";

/** Human-friendly title for messy Access keys. */
function refListTitle(kind: string): { title: string; full: string } {
  const t = kind.trim();
  const looksEncoded =
    t.length > 40 ||
    (t.includes(";") && (t.includes("'") || t.includes('"'))) ||
    /^a_/i.test(t);
  if (looksEncoded && t.length > 36) {
    return { title: `${t.slice(0, 34)}…`, full: t };
  }
  return { title: t, full: t };
}

export function RefsAdminPage() {
  const backend = isBackendMode();
  const auth = useAuth();
  const admin = !auth.authRequired || auth.role === "admin";
  const [searchParams, setSearchParams] = useSearchParams();

  const [rules, setRules] = useState<RashRule[]>([]);
  const [baseRefs, setBaseRefs] = useState<RashRefsData | null>(null);
  const [overlay, setOverlay] = useState<RefsOverlayPackage>(emptyRefsOverlay());
  const [agents, setAgents] = useState<KontrAgent[]>([]);
  const [selectedKind, setSelectedKind] = useState<string | null>(null);
  const [draftItems, setDraftItems] = useState<RashRefItem[]>([]);
  const [kontrDraft, setKontrDraft] = useState<KontrDraft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [dirFilter, setDirFilter] = useState<DirFilter>("used");
  const [q, setQ] = useState("");
  const [itemQ, setItemQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [baseLoadWarning, setBaseLoadWarning] = useState("");
  const [itemPage, setItemPage] = useState(0);
  const [selectedKontrId, setSelectedKontrId] = useState<number | null>(null);
  const [kontrVersions, setKontrVersions] = useState<KontrVersionDto[]>([]);
  const [kontrUsages, setKontrUsages] = useState<KontrUsageHit[]>([]);
  const [versionsBusy, setVersionsBusy] = useState(false);

  const isKontr = selectedKind?.toLowerCase() === "контрагент";
  const isLoanGroup = selectedKind ? isLoanNzsGroup(selectedKind) : false;
  const canMutate = canMutateData();
  const canEditKontr = admin && backend && canMutate;
  const canEditItems = admin && !isKontr && !isLoanGroup && canMutate;

  const effectiveRefs = useMemo(() => {
    if (!baseRefs) return { version: "0", byName: {} } as RashRefsData;
    return applyRefsOverlay(baseRefs, overlay);
  }, [baseRefs, overlay]);

  const directories = useMemo(() => {
    const dirs = listRefDirectories(rules, effectiveRefs, overlay);
    return dirs.map((d) =>
      d.isKontr ? { ...d, itemCount: agents.length } : d
    );
  }, [rules, effectiveRefs, overlay, agents.length]);

  const visibleDirs = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return directories.filter((d) => {
      if (dirFilter === "used") {
        if (d.technical && !d.isKontr) return false;
        if (d.ruleCount === 0 && !d.isKontr) return false;
      } else if (dirFilter === "edited") {
        if (!d.overridden) return false;
      } else if (dirFilter === "technical") {
        if (!d.technical) return false;
      }
      if (!needle) return true;
      return d.kind.toLowerCase().includes(needle);
    });
  }, [directories, q, dirFilter]);

  const editedCount = useMemo(
    () => directories.filter((d) => d.overridden).length,
    [directories]
  );

  const quickPicks = useMemo(() => {
    return [...directories]
      .filter((d) => d.ruleCount > 0 || d.isKontr)
      .sort((a, b) => {
        if (a.isKontr !== b.isKontr) return a.isKontr ? -1 : 1;
        return b.ruleCount - a.ruleCount;
      })
      .slice(0, 4);
  }, [directories]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setStatus("");
    setBaseLoadWarning("");
    try {
      clearRashRefsCache();
      const [ov, rash, rawRes, kontr] = await Promise.all([
        loadRefsOverlay(),
        loadRashRules(),
        fetch("/data/rash-refs.json"),
        loadKontrAgents().catch((e) => {
          throw e instanceof Error ? e : new Error("Ошибка загрузки контрагентов");
        }),
      ]);
      let raw: RashRefsData = { version: "0", byName: {} };
      if (!rawRes.ok) {
        setBaseLoadWarning(
          `Не удалось загрузить rash-refs.json (HTTP ${rawRes.status}). Сохранение классификаторов заблокировано.`
        );
      } else {
        raw = (await rawRes.json()) as RashRefsData;
        if (!raw.byName || Object.keys(raw.byName).length === 0) {
          setBaseLoadWarning(
            "Базовый файл справочников пуст. Сохранение классификаторов заблокировано."
          );
        }
      }
      const { loadEffectiveLoansNzs, applyLoansNzsToRashRefs } = await import(
        "../engine/refsPackage"
      );
      const withLoans = applyLoansNzsToRashRefs(raw, await loadEffectiveLoansNzs());
      setBaseRefs(withLoans);
      setOverlay(ov);
      setRules(rash.rules ?? []);
      setAgents(kontr);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки справочников");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const kind = searchParams.get("kind");
    if (kind) setSelectedKind(kind);
  }, [searchParams]);

  useEffect(() => {
    if (!selectedKind) return;
    setItemQ("");
    if (dirty) return;
    if (selectedKind.toLowerCase() === "контрагент") {
      setDraftItems([]);
      setKontrDraft(agents.map(agentToDraft));
      return;
    }
    setKontrDraft([]);
    const items = effectiveRefs.byName[selectedKind] ?? [];
    setDraftItems(items.map((it) => ({ ...it })));
  }, [selectedKind, effectiveRefs, agents, dirty]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const PAGE_SIZE = 200;
  useEffect(() => {
    setItemPage(0);
  }, [selectedKind, itemQ]);

  const filteredItemIndexes = useMemo(() => {
    const needle = itemQ.trim().toLowerCase();
    const out: number[] = [];
    draftItems.forEach((it, idx) => {
      if (
        !needle ||
        it.kod.toLowerCase().includes(needle) ||
        it.value.toLowerCase().includes(needle) ||
        (it.note ?? "").toLowerCase().includes(needle) ||
        (it.newkod ?? "").toLowerCase().includes(needle)
      ) {
        out.push(idx);
      }
    });
    return out;
  }, [draftItems, itemQ]);

  const filteredKontrIndexes = useMemo(() => {
    const needle = itemQ.trim().toLowerCase();
    const out: number[] = [];
    kontrDraft.forEach((it, idx) => {
      if (
        !needle ||
        String(it.id ?? "").includes(needle) ||
        it.name.toLowerCase().includes(needle) ||
        it.oldName.toLowerCase().includes(needle) ||
        it.inn.includes(needle) ||
        it.kpp.includes(needle) ||
        it.idObdnsi.toLowerCase().includes(needle)
      ) {
        out.push(idx);
      }
    });
    return out;
  }, [kontrDraft, itemQ]);

  const pagedItemIndexes = useMemo(() => {
    const start = itemPage * PAGE_SIZE;
    return filteredItemIndexes.slice(start, start + PAGE_SIZE);
  }, [filteredItemIndexes, itemPage]);

  const pagedKontrIndexes = useMemo(() => {
    const start = itemPage * PAGE_SIZE;
    return filteredKontrIndexes.slice(start, start + PAGE_SIZE);
  }, [filteredKontrIndexes, itemPage]);

  const totalFiltered = isKontr ? filteredKontrIndexes.length : filteredItemIndexes.length;
  const pageCount = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));

  const selectDir = (d: UsedRefDirectory) => {
    if (dirty && !confirm("Есть несохранённые изменения. Продолжить?")) return;
    setDirty(false);
    setSelectedKind(d.kind);
    setSearchParams(d.kind === "Контрагент" ? { kind: "Контрагент" } : { kind: d.kind });
    setStatus("");
    setError("");
  };

  const updateItem = (idx: number, patch: Partial<RashRefItem>) => {
    setDraftItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
    setDirty(true);
  };

  const updateKontr = (idx: number, patch: Partial<KontrDraft>) => {
    setKontrDraft((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, ...patch, dirty: true } : it))
    );
    setDirty(true);
  };

  const addItem = () => {
    if (isKontr) {
      setKontrDraft((prev) => [
        ...prev,
        {
          id: null,
          name: "",
          oldName: "",
          inn: "",
          kpp: "",
          orgType: "3",
          idObdnsi: "",
          isNew: true,
          dirty: true,
        },
      ]);
    } else {
      setDraftItems((prev) => [...prev, { kod: "", value: "", note: null }]);
    }
    setDirty(true);
  };

  const removeItem = (idx: number) => {
    if (isKontr) {
      const row = kontrDraft[idx];
      if (row?.id != null) {
        setStatus(
          "Удаление существующих контрагентов не поддерживается — очистите поля или выполните реимпорт из kontr.json."
        );
        return;
      }
      setKontrDraft((prev) => prev.filter((_, i) => i !== idx));
    } else {
      setDraftItems((prev) => prev.filter((_, i) => i !== idx));
    }
    setDirty(true);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!admin || !selectedKind) return;
    if (isLoanGroup) {
      setError("Группы KZS/НЗС редактируются через «Сводка и импорт → Справочники»");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    try {
      if (isKontr) {
        if (!backend) throw new Error("Контрагенты доступны только в режиме API");
        const dirtyRows = kontrDraft.filter((row) => row.dirty || row.isNew || row.id == null);
        const toSave = dirtyRows.filter((row) => row.name.trim());
        for (const row of toSave) {
          const errs = validateKontrDraftRow(row);
          if (errs.length) {
            throw new Error(`«${row.name || "без имени"}»: ${errs.join("; ")}`);
          }
        }
        if (toSave.length === 0) {
          setStatus("Нет изменённых строк для сохранения");
          setDirty(false);
          return;
        }
        const result = await bulkUpsertKontrAgents(
          toSave.map((row) => ({
            id: row.id == null || row.isNew ? null : row.id,
            name: row.name.trim(),
            oldName: row.oldName.trim() || null,
            inn: row.inn.trim() || null,
            kpp: row.kpp.trim() || null,
            orgType: row.orgType.trim() === "" ? null : Number(row.orgType),
            idObdnsi: row.idObdnsi.trim() || null,
          }))
        );
        const list = await loadKontrAgents();
        setAgents(list);
        setKontrDraft(list.map(agentToDraft));
        setDirty(false);
        setStatus(
          `Сохранено: создано ${result.created}, обновлено ${result.updated}`
        );
      } else {
        if (baseLoadWarning) {
          throw new Error(baseLoadWarning);
        }
        const cleaned = draftItems
          .map((it) => ({
            kod: String(it.kod ?? "").trim(),
            value: String(it.value ?? "").trim(),
            note: it.note?.trim() ? it.note.trim() : null,
            newkod: it.newkod?.trim() ? it.newkod.trim() : null,
          }))
          .filter((it) => it.kod || it.value);
        const meta = directories.find((d) => d.kind === selectedKind);
        const validation = validateClassifierItems(cleaned, {
          ruleCount: meta?.ruleCount ?? 0,
        });
        if (validation.length) {
          throw new Error(validation.join(". "));
        }
        const next: RefsOverlayPackage = {
          ...overlay,
          byName: { ...overlay.byName, [selectedKind]: cleaned },
        };
        await saveRefsOverlay(next);
        setOverlay(next);
        clearRashRefsCache();
        setDirty(false);
        setStatus(`Сохранено: «${selectedKind}» (${cleaned.length} записей)`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  };

  const handleResetGroup = async () => {
    if (!admin || !selectedKind || isKontr || isLoanGroup) return;
    if (!confirm(`Сбросить «${selectedKind}» к bundled JSON (убрать правки)?`)) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const byName = { ...overlay.byName };
      delete byName[selectedKind];
      const next: RefsOverlayPackage = { ...overlay, byName };
      await saveRefsOverlay(next);
      setOverlay(next);
      clearRashRefsCache();
      const baseItems = baseRefs?.byName[selectedKind] ?? [];
      setDraftItems(baseItems.map((it) => ({ ...it })));
      setDirty(false);
      setStatus(`Сброшено к исходным данным: «${selectedKind}»`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сброса");
    } finally {
      setBusy(false);
    }
  };

  const handleKontrExcel = async () => {
    const filtered = filteredKontrIndexes.length;
    const total = kontrDraft.length;
    const scope =
      itemQ.trim() && filtered !== total
        ? `показанные ${filtered} из ${total}`
        : `все ${total}`;
    if (
      itemQ.trim() &&
      filtered !== total &&
      !confirm(`Выгрузить в Excel только отфильтрованные строки (${filtered} из ${total})?`)
    ) {
      return;
    }
    const rows = kontrDraft
      .filter((_, i) => filteredKontrIndexes.includes(i))
      .map((a) => ({
        id: a.id ?? "",
        name: a.name,
        oldName: a.oldName,
        inn: a.inn,
        kpp: a.kpp,
        orgType: a.orgType,
        idOBDNSI: a.idObdnsi,
      }));
    const bytes = await writeJsonSheetWorkbook(rows, "kontr");
    triggerBrowserDownload(`oko-kontr-${new Date().toISOString().slice(0, 10)}.xlsx`, bytes);
    setStatus(`Excel (${scope}): ${rows.length} строк`);
  };

  const handleKontrReimport = async () => {
    if (!backend) return;
    if (
      !confirm(
        "Реимпорт полностью заменит всех контрагентов данными из kontr.json. Локальные правки будут потеряны. Продолжить?"
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const n = await reimportKontrAgents();
      const list = await loadKontrAgents();
      setAgents(list);
      if (isKontr) setKontrDraft(list.map(agentToDraft));
      setDirty(false);
      setStatus(`Реимпорт контрагентов: ${n}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка реимпорта");
    } finally {
      setBusy(false);
    }
  };

  const loadKontrVersionsPanel = useCallback(
    async (kontrId: number) => {
      if (!backend) return;
      setVersionsBusy(true);
      setError("");
      try {
        const [versions, usages] = await Promise.all([
          listKontrVersions(kontrId),
          listKontrUsages(kontrId),
        ]);
        setKontrVersions(versions);
        setKontrUsages(usages);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ошибка загрузки версий");
        setKontrVersions([]);
        setKontrUsages([]);
      } finally {
        setVersionsBusy(false);
      }
    },
    [backend]
  );

  const selectKontrRow = (id: number | null) => {
    setSelectedKontrId(id);
    if (id != null && backend) void loadKontrVersionsPanel(id);
    else {
      setKontrVersions([]);
      setKontrUsages([]);
    }
  };

  const handleCreateKontrVersion = async () => {
    if (!selectedKontrId || !canMutate) return;
    const row = kontrDraft.find((k) => k.id === selectedKontrId);
    if (!row?.name.trim()) {
      setError("Выберите существующую запись с наименованием");
      return;
    }
    setVersionsBusy(true);
    setError("");
    setStatus("");
    try {
      await createKontrVersion(selectedKontrId, {
        fields: {
          name: row.name.trim(),
          oldName: row.oldName.trim() || null,
          inn: row.inn.trim() || null,
          kpp: row.kpp.trim() || null,
          orgType: row.orgType.trim() === "" ? null : Number(row.orgType),
          idObdnsi: row.idObdnsi.trim() || null,
        },
      });
      setStatus(`Версия создана для контрагента #${selectedKontrId}`);
      await loadKontrVersionsPanel(selectedKontrId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка создания версии");
    } finally {
      setVersionsBusy(false);
    }
  };

  const handleArchiveKontr = async () => {
    if (!selectedKontrId || !canMutate) return;
    if (kontrUsages.length > 0) {
      const ok = confirm(
        `Контрагент используется в ${kontrUsages.length} местах. Архивировать принудительно?`
      );
      if (!ok) return;
    } else if (!confirm("Архивировать контрагента?")) {
      return;
    }
    setVersionsBusy(true);
    setError("");
    setStatus("");
    try {
      await archiveKontrVersion(selectedKontrId, kontrUsages.length > 0);
      setStatus(`Контрагент #${selectedKontrId} архивирован`);
      await load();
      setSelectedKontrId(null);
      setKontrVersions([]);
      setKontrUsages([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка архивации");
    } finally {
      setVersionsBusy(false);
    }
  };

  const usedCount = directories.filter((d) => d.ruleCount > 0 || d.isKontr).length;
  const recordCount = isKontr ? kontrDraft.length : draftItems.length;
  const selectedMeta = directories.find((d) => d.kind === selectedKind);
  const showNewkodCol = draftItems.some((it) => it.newkod);

  return (
    <div className="page-block refs-page">
      <div className="refs-page-header">
        <div className="refs-page-heading">
          <h1>Справочники</h1>
          <p className="refs-page-stats">
            <span className="stat">{usedCount} в правилах</span>
            <span className="stat">{directories.length} всего</span>
            {editedCount > 0 && (
              <span className="stat">{editedCount} с правками</span>
            )}
          </p>
          <details className="refs-how">
            <summary>Как это работает</summary>
            <p>
              Классификаторы расшифровок правятся поверх bundled JSON
              {backend ? " (настройки API)" : " (localStorage)"}. Контрагенты — через API.
              KZS/НЗС — только через{" "}
              <Link to="/tools?tab=references">Сводка и импорт → Справочники</Link>. Связанный
              редактор: <Link to="/admin/rash">Расшифровки</Link>.
            </p>
          </details>
        </div>
        <div className="toolbar-actions">
          <Link to="/admin/rash" className="btn btn-secondary btn-sm">
            Расшифровки
          </Link>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={loading || busy}
            onClick={() => void load()}
          >
            Обновить
          </button>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}
      {baseLoadWarning && <div className="error-box">{baseLoadWarning}</div>}
      {status && <div className="status-bar">{status}</div>}
      {loading && (
        <LoadingSkeleton variant="rows" count={8} label="Загрузка справочников…" />
      )}

      {!loading && (
        <div className="forms-workbench refs-admin">
          <aside className="refs-admin-list">
            <label className="refs-sr-only" htmlFor="refs-dir-search">
              Поиск справочника
            </label>
            <input
              id="refs-dir-search"
              className="search-input"
              placeholder="Поиск справочника…"
              aria-label="Поиск справочника"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="refs-filter-chips" role="group" aria-label="Фильтр списка">
              {(
                [
                  ["used", "Используемые"],
                  ["all", "Все"],
                  ["edited", "С правками"],
                  ["technical", "Технические"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`refs-chip${dirFilter === id ? " is-active" : ""}`}
                  aria-pressed={dirFilter === id}
                  onClick={() => setDirFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="refs-list-count">
              Показано <strong>{visibleDirs.length}</strong>
            </p>
            <ul className="refs-dir-list">
              {visibleDirs.map((d) => {
                const { title, full } = refListTitle(d.kind);
                return (
                  <li key={d.kind}>
                    <button
                      type="button"
                      className={`refs-dir-item${selectedKind === d.kind ? " active" : ""}${
                        d.isKontr ? " is-kontr" : ""
                      }`}
                      onClick={() => selectDir(d)}
                      title={full}
                    >
                      <span className="refs-dir-name">{title}</span>
                      <span className="refs-dir-badges">
                        {d.isKontr && <span className="refs-badge refs-badge-kontr">Контрагенты</span>}
                        {isLoanNzsGroup(d.kind) && (
                          <span className="refs-badge">KZS/НЗС</span>
                        )}
                        {d.technical && (
                          <span className="refs-badge refs-badge-tech">техн.</span>
                        )}
                        {d.overridden && (
                          <span className="refs-badge refs-badge-edit">правки</span>
                        )}
                        <span className="refs-badge">{d.itemCount} зап.</span>
                        {!d.isKontr && (
                          <span className="refs-badge">{d.ruleCount} прав.</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
              {visibleDirs.length === 0 && (
                <li className="refs-list-empty">Нет справочников по фильтру</li>
              )}
            </ul>
          </aside>

          <div className="refs-admin-detail">
            {!selectedKind && (
              <div className="refs-empty-state">
                <h2>Выберите справочник</h2>
                <p>Слева — классификаторы расшифровок и контрагенты. Начните с часто используемых:</p>
                <div className="refs-quick-picks">
                  {quickPicks.map((d) => (
                    <button
                      key={d.kind}
                      type="button"
                      className="refs-quick-pick"
                      onClick={() => selectDir(d)}
                    >
                      <span className="refs-quick-pick-title">
                        {refListTitle(d.kind).title}
                      </span>
                      <span className="refs-quick-pick-meta">
                        {d.isKontr
                          ? `${d.itemCount} записей`
                          : `${d.ruleCount} правил · ${d.itemCount} записей`}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedKind && (
              <form className="refs-detail-form" onSubmit={(e) => void handleSave(e)}>
                {dirty && (
                  <div className="refs-dirty-bar" role="status">
                    Есть несохранённые изменения
                  </div>
                )}
                <header className="refs-detail-header">
                  <div className="refs-detail-title">
                    <h2 title={selectedKind}>{refListTitle(selectedKind).title}</h2>
                    <div className="refs-dir-badges">
                      <span className="refs-badge">{recordCount} записей</span>
                      {selectedMeta && selectedMeta.ruleCount > 0 && (
                        <span className="refs-badge">{selectedMeta.ruleCount} правил</span>
                      )}
                      {isKontr ? (
                        <span className="refs-badge refs-badge-kontr">
                          {backend ? "API" : "kontr.json"}
                        </span>
                      ) : isLoanGroup ? (
                        <span className="refs-badge">только Tools</span>
                      ) : overlay.byName[selectedKind] ? (
                        <span className="refs-badge refs-badge-edit">локальные правки</span>
                      ) : (
                        <span className="refs-badge">bundled</span>
                      )}
                    </div>
                  </div>
                  <div className="refs-detail-actions">
                    <label className="refs-sr-only" htmlFor="refs-item-search">
                      Фильтр записей
                    </label>
                    <input
                      id="refs-item-search"
                      className="search-input"
                      placeholder="Фильтр записей…"
                      aria-label="Фильтр записей"
                      value={itemQ}
                      onChange={(e) => setItemQ(e.target.value)}
                    />
                    {isKontr && (
                      <>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={busy || kontrDraft.length === 0}
                          onClick={() => void handleKontrExcel()}
                          title={
                            itemQ.trim()
                              ? `Excel: показанные ${filteredKontrIndexes.length}`
                              : `Excel: все ${kontrDraft.length}`
                          }
                        >
                          Excel
                          {itemQ.trim()
                            ? ` (${filteredKontrIndexes.length})`
                            : ` (${kontrDraft.length})`}
                        </button>
                        {backend && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busy || !admin}
                            onClick={() => void handleKontrReimport()}
                          >
                            Реимпорт
                          </button>
                        )}
                      </>
                    )}
                    {(canEditKontr || canEditItems) && (
                      <>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={busy}
                          onClick={addItem}
                        >
                          + Запись
                        </button>
                        {canEditItems && overlay.byName[selectedKind] && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busy}
                            onClick={() => void handleResetGroup()}
                          >
                            Сбросить
                          </button>
                        )}
                        <button
                          type="submit"
                          className="btn btn-primary btn-sm"
                          disabled={!dirty || busy || Boolean(baseLoadWarning && !isKontr)}
                        >
                          {busy ? "Сохранение…" : "Сохранить"}
                        </button>
                      </>
                    )}
                  </div>
                </header>

                {!admin && (
                  <p className="tools-hint">Только просмотр (нужна роль admin).</p>
                )}
                {isKontr && !backend && (
                  <p className="tools-hint">
                    Просмотр из <code>kontr.json</code>. Редактирование — в режиме API.
                  </p>
                )}
                {isLoanGroup && (
                  <p className="tools-hint">
                    Группа управляется пакетом займов/НЗС. Импорт и правка:{" "}
                    <Link to="/tools?tab=references">Сводка и импорт → Справочники</Link>.
                  </p>
                )}

                <div className="table-wrap refs-table-wrap">
                  {isKontr ? (
                    <>
                    <table className="data-table refs-data-table">
                      <thead>
                        <tr>
                          <th style={{ width: "5rem" }} scope="col">
                            ID
                          </th>
                          <th scope="col">Наименование</th>
                          <th scope="col">Другое наим.</th>
                          <th style={{ width: "8rem" }} scope="col">
                            ИНН
                          </th>
                          <th style={{ width: "7rem" }} scope="col">
                            КПП
                          </th>
                          <th style={{ width: "6rem" }} scope="col" title="1 ВГ / 2 assoc / 3 внешн.">
                            Тип
                          </th>
                          <th scope="col">idOBDNSI</th>
                          {canEditKontr && <th className="actions-col" scope="col" />}
                        </tr>
                      </thead>
                      <tbody>
                        {pagedKontrIndexes.map((realIdx) => {
                          const it = kontrDraft[realIdx];
                          const selected = it.id != null && it.id === selectedKontrId;
                          return (
                            <tr
                              key={it.id ?? `new-${realIdx}`}
                              className={selected ? "is-selected" : undefined}
                              style={it.id != null ? { cursor: "pointer" } : undefined}
                              onClick={() => {
                                if (it.id != null) selectKontrRow(it.id);
                              }}
                            >
                              <td className="muted">{it.id ?? "новый"}</td>
                              <td>
                                {canEditKontr ? (
                                  <input
                                    aria-label={`Наименование ${it.id ?? "новый"}`}
                                    value={it.name}
                                    onChange={(e) =>
                                      updateKontr(realIdx, { name: e.target.value })
                                    }
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                ) : (
                                  it.name
                                )}
                              </td>
                              <td>
                                {canEditKontr ? (
                                  <input
                                    aria-label={`Другое наименование ${it.id ?? "новый"}`}
                                    value={it.oldName}
                                    onChange={(e) =>
                                      updateKontr(realIdx, { oldName: e.target.value })
                                    }
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                ) : (
                                  it.oldName
                                )}
                              </td>
                              <td>
                                {canEditKontr ? (
                                  <input
                                    aria-label={`ИНН ${it.id ?? "новый"}`}
                                    value={it.inn}
                                    inputMode="numeric"
                                    onChange={(e) =>
                                      updateKontr(realIdx, { inn: e.target.value })
                                    }
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                ) : (
                                  it.inn
                                )}
                              </td>
                              <td>
                                {canEditKontr ? (
                                  <input
                                    aria-label={`КПП ${it.id ?? "новый"}`}
                                    value={it.kpp}
                                    inputMode="numeric"
                                    onChange={(e) =>
                                      updateKontr(realIdx, { kpp: e.target.value })
                                    }
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                ) : (
                                  it.kpp
                                )}
                              </td>
                              <td>
                                {canEditKontr ? (
                                  <select
                                    aria-label={`Тип ${it.id ?? "новый"}`}
                                    value={it.orgType}
                                    onChange={(e) =>
                                      updateKontr(realIdx, { orgType: e.target.value })
                                    }
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <option value="">—</option>
                                    <option value="1">1 ВГ</option>
                                    <option value="2">2 assoc</option>
                                    <option value="3">3 внешн.</option>
                                  </select>
                                ) : (
                                  it.orgType
                                )}
                              </td>
                              <td>
                                {canEditKontr ? (
                                  <input
                                    aria-label={`idOBDNSI ${it.id ?? "новый"}`}
                                    value={it.idObdnsi}
                                    onChange={(e) =>
                                      updateKontr(realIdx, { idObdnsi: e.target.value })
                                    }
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                ) : (
                                  it.idObdnsi
                                )}
                              </td>
                              {canEditKontr && (
                                <td className="actions-col">
                                  {(it.id == null || it.isNew) && (
                                    <button
                                      type="button"
                                      className="btn-icon"
                                      title="Удалить строку"
                                      aria-label="Удалить строку"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        removeItem(realIdx);
                                      }}
                                    >
                                      ×
                                    </button>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                        {filteredKontrIndexes.length === 0 && (
                          <tr>
                            <td colSpan={canEditKontr ? 8 : 7} className="muted">
                              Нет записей
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    {backend && isKontr && (
                      <div className="tools-section" style={{ marginTop: "1rem" }}>
                        <h3>Версии</h3>
                        {!selectedKontrId && (
                          <p className="tools-hint">Выберите контрагента в таблице</p>
                        )}
                        {selectedKontrId != null && (
                          <>
                            <p className="tools-hint">
                              Контрагент #{selectedKontrId}
                              {versionsBusy ? " · загрузка…" : ""}
                            </p>
                            <div className="toolbar-actions" style={{ marginBottom: 8 }}>
                              {canMutate && (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  disabled={versionsBusy}
                                  onClick={() => void handleCreateKontrVersion()}
                                >
                                  Создать версию из текущей записи
                                </button>
                              )}
                              {canMutate && (
                                <button
                                  type="button"
                                  className="btn btn-danger-outline btn-sm"
                                  disabled={versionsBusy}
                                  onClick={() => void handleArchiveKontr()}
                                >
                                  Архивировать
                                </button>
                              )}
                            </div>
                            {kontrUsages.length > 0 && (
                              <p className="tools-hint">
                                Использований перед архивом: {kontrUsages.length} (
                                {kontrUsages
                                  .slice(0, 5)
                                  .map((u) => `${u.formId}/${u.source}`)
                                  .join(", ")}
                                {kontrUsages.length > 5 ? "…" : ""})
                              </p>
                            )}
                            <table className="data-table">
                              <thead>
                                <tr>
                                  <th>№</th>
                                  <th>Наименование</th>
                                  <th>ИНН</th>
                                  <th>С</th>
                                  <th>По</th>
                                  <th>Создано</th>
                                </tr>
                              </thead>
                              <tbody>
                                {kontrVersions.map((v) => (
                                  <tr key={v.id}>
                                    <td>{v.versionNo}</td>
                                    <td>{v.name}</td>
                                    <td>{v.inn ?? "—"}</td>
                                    <td>{v.validFrom ?? "—"}</td>
                                    <td>{v.validTo ?? "—"}</td>
                                    <td>
                                      {v.createdAt}
                                      {v.createdBy ? ` (${v.createdBy})` : ""}
                                    </td>
                                  </tr>
                                ))}
                                {!kontrVersions.length && !versionsBusy && (
                                  <tr>
                                    <td colSpan={6}>Версий пока нет</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </>
                        )}
                      </div>
                    )}
                    </>
                  ) : (
                    <table className="data-table refs-data-table">
                      <thead>
                        <tr>
                          <th style={{ width: "7rem" }} scope="col">
                            Код
                          </th>
                          <th scope="col">Значение</th>
                          <th scope="col">Примечание</th>
                          {showNewkodCol && (
                            <th style={{ width: "7rem" }} scope="col">
                              newkod
                            </th>
                          )}
                          {canEditItems && <th className="actions-col" scope="col" />}
                        </tr>
                      </thead>
                      <tbody>
                        {pagedItemIndexes.map((realIdx) => {
                          const it = draftItems[realIdx];
                          const rowKey = `${it.kod}|${it.newkod ?? ""}|${realIdx}`;
                          return (
                            <tr key={rowKey}>
                              <td>
                                {canEditItems ? (
                                  <input
                                    aria-label={`Код строки ${realIdx + 1}`}
                                    value={it.kod}
                                    onChange={(e) =>
                                      updateItem(realIdx, { kod: e.target.value })
                                    }
                                  />
                                ) : (
                                  it.kod
                                )}
                              </td>
                              <td>
                                {canEditItems ? (
                                  <input
                                    aria-label={`Значение строки ${realIdx + 1}`}
                                    value={it.value}
                                    onChange={(e) =>
                                      updateItem(realIdx, { value: e.target.value })
                                    }
                                  />
                                ) : (
                                  it.value
                                )}
                              </td>
                              <td>
                                {canEditItems ? (
                                  <input
                                    aria-label={`Примечание строки ${realIdx + 1}`}
                                    value={it.note ?? ""}
                                    onChange={(e) =>
                                      updateItem(realIdx, {
                                        note: e.target.value || null,
                                      })
                                    }
                                  />
                                ) : (
                                  it.note ?? ""
                                )}
                              </td>
                              {showNewkodCol && (
                                <td>
                                  {canEditItems ? (
                                    <input
                                      aria-label={`newkod строки ${realIdx + 1}`}
                                      value={it.newkod ?? ""}
                                      onChange={(e) =>
                                        updateItem(realIdx, {
                                          newkod: e.target.value || null,
                                        })
                                      }
                                    />
                                  ) : (
                                    it.newkod ?? ""
                                  )}
                                </td>
                              )}
                              {canEditItems && (
                                <td className="actions-col">
                                  <button
                                    type="button"
                                    className="btn-icon"
                                    title="Удалить"
                                    aria-label="Удалить запись"
                                    onClick={() => removeItem(realIdx)}
                                  >
                                    ×
                                  </button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                        {filteredItemIndexes.length === 0 && (
                          <tr>
                            <td
                              colSpan={
                                (canEditItems ? 4 : 3) + (showNewkodCol ? 1 : 0)
                              }
                              className="muted"
                            >
                              Нет записей
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
                {totalFiltered > PAGE_SIZE && (
                  <div className="toolbar-actions" style={{ marginTop: "0.5rem" }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={itemPage <= 0}
                      onClick={() => setItemPage((p) => Math.max(0, p - 1))}
                    >
                      ← Назад
                    </button>
                    <span className="tools-hint">
                      Стр. {itemPage + 1} / {pageCount} · показано{" "}
                      {isKontr ? pagedKontrIndexes.length : pagedItemIndexes.length} из{" "}
                      {totalFiltered}
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={itemPage + 1 >= pageCount}
                      onClick={() => setItemPage((p) => Math.min(pageCount - 1, p + 1))}
                    >
                      Вперёд →
                    </button>
                  </div>
                )}
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
