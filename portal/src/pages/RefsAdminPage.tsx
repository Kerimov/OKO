import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { loadRashRules } from "../api";
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
import { writeJsonSheetWorkbook, triggerBrowserDownload } from "../engine/excelWorkbook";
import {
  addKontrAgent,
  isBackendMode,
  loadKontrAgents,
  reimportKontrAgents,
  updateKontrAgent,
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

  const isKontr = selectedKind?.toLowerCase() === "контрагент";
  const canEditKontr = admin && backend;
  const canEditItems = admin && !isKontr;

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
      if (dirFilter === "used" && d.ruleCount === 0 && !d.isKontr) return false;
      if (dirFilter === "edited" && !d.overridden && !d.isKontr) return false;
      if (dirFilter === "technical" && !d.technical) return false;
      if (dirFilter !== "technical" && dirFilter !== "all" && d.technical && !d.isKontr) {
        /* keep technical hidden unless explicitly requested or "all" */
        if (dirFilter === "used" || dirFilter === "edited") return false;
      }
      if (dirFilter === "all" && d.technical) return true;
      if (dirFilter === "used" && d.technical) return false;
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
    try {
      clearRashRefsCache();
      const [ov, rash, raw, kontr] = await Promise.all([
        loadRefsOverlay(),
        loadRashRules(),
        fetch("/data/rash-refs.json").then(async (r) =>
          r.ok
            ? ((await r.json()) as RashRefsData)
            : ({ version: "0", byName: {} } as RashRefsData)
        ),
        loadKontrAgents().catch(() => [] as KontrAgent[]),
      ]);
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
    setDirty(false);
    if (selectedKind.toLowerCase() === "контрагент") {
      setDraftItems([]);
      setKontrDraft(agents.map(agentToDraft));
      return;
    }
    setKontrDraft([]);
    const items = effectiveRefs.byName[selectedKind] ?? [];
    setDraftItems(items.map((it) => ({ ...it })));
  }, [selectedKind, effectiveRefs, agents]);

  const filteredItemIndexes = useMemo(() => {
    const needle = itemQ.trim().toLowerCase();
    const out: number[] = [];
    draftItems.forEach((it, idx) => {
      if (
        !needle ||
        it.kod.toLowerCase().includes(needle) ||
        it.value.toLowerCase().includes(needle) ||
        (it.note ?? "").toLowerCase().includes(needle)
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

  const selectDir = (d: UsedRefDirectory) => {
    if (dirty && !confirm("Есть несохранённые изменения. Продолжить?")) return;
    setSelectedKind(d.kind);
    setSearchParams(d.kind === "Контрагент" ? { kind: "Контрагент" } : { kind: d.kind });
    setStatus("");
  };

  const updateItem = (idx: number, patch: Partial<RashRefItem>) => {
    setDraftItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
    setDirty(true);
  };

  const updateKontr = (idx: number, patch: Partial<KontrDraft>) => {
    setKontrDraft((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
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
        setStatus("Удаление контрагентов из UI не поддерживается — очистите поля или снимите с использования.");
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
    setBusy(true);
    setError("");
    try {
      if (isKontr) {
        if (!backend) throw new Error("Контрагенты доступны только в режиме API");
        let saved = 0;
        for (const row of kontrDraft) {
          const name = row.name.trim();
          if (!name) continue;
          const payload = {
            name,
            oldName: row.oldName.trim() || null,
            inn: row.inn.trim() || null,
            kpp: row.kpp.trim() || null,
            orgType: row.orgType.trim() === "" ? null : Number(row.orgType),
            idObdnsi: row.idObdnsi.trim() || null,
          };
          if (row.id == null || row.isNew) {
            await addKontrAgent({
              name: payload.name,
              orgType: payload.orgType ?? 3,
              inn: payload.inn,
              kpp: payload.kpp,
              oldName: payload.oldName,
              idObdnsi: payload.idObdnsi,
            });
          } else {
            await updateKontrAgent(row.id, payload);
          }
          saved++;
        }
        const list = await loadKontrAgents();
        setAgents(list);
        setKontrDraft(list.map(agentToDraft));
        setDirty(false);
        setStatus(`Сохранено контрагентов: ${saved}`);
      } else {
        const cleaned = draftItems
          .map((it) => ({
            kod: String(it.kod ?? "").trim(),
            value: String(it.value ?? "").trim(),
            note: it.note?.trim() ? it.note.trim() : null,
            newkod: it.newkod?.trim() ? it.newkod.trim() : null,
          }))
          .filter((it) => it.kod || it.value);
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
    if (!admin || !selectedKind || isKontr) return;
    if (!confirm(`Сбросить «${selectedKind}» к bundled JSON (убрать правки)?`)) return;
    setBusy(true);
    setError("");
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
    setStatus(`Excel: ${rows.length} строк`);
  };

  const handleKontrReimport = async () => {
    if (!backend) return;
    setBusy(true);
    setError("");
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

  const usedCount = directories.filter((d) => d.ruleCount > 0 || d.isKontr).length;
  const recordCount = isKontr ? kontrDraft.length : draftItems.length;
  const selectedMeta = directories.find((d) => d.kind === selectedKind);

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
              Связанный редактор:{" "}
              <Link to="/admin/rash">Расшифровки</Link>.
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
      {status && <div className="status-bar">{status}</div>}
      {loading && (
        <LoadingSkeleton variant="rows" count={8} label="Загрузка справочников…" />
      )}

      {!loading && (
        <div className="forms-workbench refs-admin">
          <aside className="refs-admin-list">
            <input
              className="search-input"
              placeholder="Поиск справочника…"
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
                      ) : overlay.byName[selectedKind] ? (
                        <span className="refs-badge refs-badge-edit">локальные правки</span>
                      ) : (
                        <span className="refs-badge">bundled</span>
                      )}
                    </div>
                  </div>
                  <div className="refs-detail-actions">
                    <input
                      className="search-input"
                      placeholder="Фильтр записей…"
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
                        >
                          Excel
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
                          disabled={!dirty || busy}
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

                <div className="table-wrap refs-table-wrap">
                  {isKontr ? (
                    <table className="data-table refs-data-table">
                      <thead>
                        <tr>
                          <th style={{ width: "5rem" }}>ID</th>
                          <th>Наименование</th>
                          <th>Другое наим.</th>
                          <th style={{ width: "8rem" }}>ИНН</th>
                          <th style={{ width: "7rem" }}>КПП</th>
                          <th style={{ width: "4rem" }} title="1 ВГ / 2 assoc / 3 внешн.">
                            Тип
                          </th>
                          <th>idOBDNSI</th>
                          {canEditKontr && <th className="actions-col" />}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredKontrIndexes.map((realIdx) => {
                          const it = kontrDraft[realIdx];
                          return (
                            <tr key={it.id ?? `new-${realIdx}`}>
                              <td className="muted">{it.id ?? "новый"}</td>
                              <td>
                                {canEditKontr ? (
                                  <input
                                    value={it.name}
                                    onChange={(e) =>
                                      updateKontr(realIdx, { name: e.target.value })
                                    }
                                  />
                                ) : (
                                  it.name
                                )}
                              </td>
                              <td>
                                {canEditKontr ? (
                                  <input
                                    value={it.oldName}
                                    onChange={(e) =>
                                      updateKontr(realIdx, { oldName: e.target.value })
                                    }
                                  />
                                ) : (
                                  it.oldName
                                )}
                              </td>
                              <td>
                                {canEditKontr ? (
                                  <input
                                    value={it.inn}
                                    onChange={(e) =>
                                      updateKontr(realIdx, { inn: e.target.value })
                                    }
                                  />
                                ) : (
                                  it.inn
                                )}
                              </td>
                              <td>
                                {canEditKontr ? (
                                  <input
                                    value={it.kpp}
                                    onChange={(e) =>
                                      updateKontr(realIdx, { kpp: e.target.value })
                                    }
                                  />
                                ) : (
                                  it.kpp
                                )}
                              </td>
                              <td>
                                {canEditKontr ? (
                                  <input
                                    value={it.orgType}
                                    onChange={(e) =>
                                      updateKontr(realIdx, { orgType: e.target.value })
                                    }
                                  />
                                ) : (
                                  it.orgType
                                )}
                              </td>
                              <td>
                                {canEditKontr ? (
                                  <input
                                    value={it.idObdnsi}
                                    onChange={(e) =>
                                      updateKontr(realIdx, { idObdnsi: e.target.value })
                                    }
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
                                      onClick={() => removeItem(realIdx)}
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
                  ) : (
                    <table className="data-table refs-data-table">
                      <thead>
                        <tr>
                          <th style={{ width: "7rem" }}>Код</th>
                          <th>Значение</th>
                          <th>Примечание</th>
                          {canEditItems && <th className="actions-col" />}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredItemIndexes.map((realIdx) => {
                          const it = draftItems[realIdx];
                          return (
                            <tr key={realIdx}>
                              <td>
                                {canEditItems ? (
                                  <input
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
                              {canEditItems && (
                                <td className="actions-col">
                                  <button
                                    type="button"
                                    className="btn-icon"
                                    title="Удалить"
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
                            <td colSpan={canEditItems ? 4 : 3} className="muted">
                              Нет записей
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
