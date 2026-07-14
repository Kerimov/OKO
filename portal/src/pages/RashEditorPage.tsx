import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  deleteRashRule,
  fetchNextRashKod,
  fetchRashPage,
  fetchRashPlacements,
  fetchRashRule,
  fetchRashStats,
  fetchRashThresholds,
  fetchRashUsage,
  loadCatalog,
  loadSchema,
  previewRashPlacementsImport,
  previewRashRulesImport,
  reimportRashFromJson,
  reimportRashPlacementsFromJson,
  saveRashBundle,
  saveRashThresholds,
  type RashPlacement,
  type RashRule,
} from "../api";
import { clearRowRashIndexCache } from "../engine/rowRashIndex";
import { parseTotalColumn } from "../engine/rashEngine";
import type { FormCatalog, FormSchema, RashAddsum, RashThresholds } from "../types";
import { isBackendMode } from "../storage";
import { useAdminAccess } from "../components/AdminAccessGate";
import {
  buildFormulaString,
  emptyFormula,
  parseFormulaDraft,
  type FormulaDraft,
} from "./rashEditor/formulaSpec";
import {
  buildRefName,
  emptyRefSpec,
  parseRefSpec,
  toggleType,
  REF_KINDS,
  type RefSpecDraft,
} from "./rashEditor/refSpec";
import {
  draftFingerprint,
  SUPPORTED_FLD_TYPES,
  validateRashDraft,
  type PlacementDraft,
} from "./rashEditor/validateDraft";

const EMPTY_RULE: RashRule = {
  kod: 0,
  name: "",
  note: null,
  refRows: null,
  totalFormula: null,
  refA1Name: null,
  refA1Title: null,
  refA2Name: null,
  refA2Title: null,
  refA3Name: null,
  refA3Title: null,
  refA4Name: null,
  refA4Title: null,
};

const SPECIAL_MODES: Record<number, string> = {
  0: "закрыта — нет ввода",
  1: "закрыта — вычисляемая",
  2: "только сумма, без расшифровки",
  3: "устаревший движок t_ras",
  4: "устаревший движок «прочие»",
  6: "устаревший движок ras_vn",
};

type DetailTab = "wizard" | "rule" | "addsum" | "placements" | "usage";
type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

function refsFromRule(rule: RashRule): [RefSpecDraft, RefSpecDraft, RefSpecDraft, RefSpecDraft] {
  return [
    parseRefSpec(rule.refA1Name, rule.refA1Title),
    parseRefSpec(rule.refA2Name, rule.refA2Title),
    parseRefSpec(rule.refA3Name, rule.refA3Title),
    parseRefSpec(rule.refA4Name, rule.refA4Title),
  ];
}

function applyRefsToRule(
  rule: RashRule,
  refs: [RefSpecDraft, RefSpecDraft, RefSpecDraft, RefSpecDraft]
): RashRule {
  return {
    ...rule,
    refA1Name: buildRefName(refs[0]),
    refA1Title: refs[0].title.trim() || null,
    refA2Name: buildRefName(refs[1]),
    refA2Title: refs[1].title.trim() || null,
    refA3Name: buildRefName(refs[2]),
    refA3Title: refs[2].title.trim() || null,
    refA4Name: buildRefName(refs[3]),
    refA4Title: refs[3].title.trim() || null,
    totalFormula: null, // set by caller from formula draft
  };
}

export function RashEditorPage() {
  const backend = isBackendMode();
  const adminOk = useAdminAccess().ok;
  const [searchParams] = useSearchParams();
  const [stats, setStats] = useState<{
    total: number;
    addsum: number;
    withFormula: number;
  } | null>(null);
  const [thresholds, setThresholds] = useState<RashThresholds | null>(null);
  const [items, setItems] = useState<RashRule[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState(
    () => searchParams.get("kod") ?? searchParams.get("q") ?? ""
  );
  const [formFilter, setFormFilter] = useState("");
  const [selected, setSelected] = useState<RashRule | null>(null);
  const [draft, setDraft] = useState<RashRule>(EMPTY_RULE);
  const [formula, setFormula] = useState<FormulaDraft>(emptyFormula());
  const [refs, setRefs] = useState<[RefSpecDraft, RefSpecDraft, RefSpecDraft, RefSpecDraft]>([
    emptyRefSpec("Контрагент"),
    emptyRefSpec(""),
    emptyRefSpec(""),
    emptyRefSpec(""),
  ]);
  const [addsumDraft, setAddsumDraft] = useState<RashAddsum[]>([]);
  const [placementsDraft, setPlacementsDraft] = useState<PlacementDraft[]>([]);
  const [savedFingerprint, setSavedFingerprint] = useState("");
  const [tab, setTab] = useState<DetailTab>("wizard");
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [catalog, setCatalog] = useState<FormCatalog | null>(null);
  const [schemas, setSchemas] = useState<Record<string, FormSchema>>({});
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof fetchRashUsage>> | null>(null);
  const [importPreview, setImportPreview] = useState<{
    kind: "rules" | "placements";
    data: unknown;
  } | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const limit = 40;

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (backend) {
        const [page, st, th] = await Promise.all([
          fetchRashPage({
            q: search || undefined,
            formId: formFilter || undefined,
            limit,
            offset,
          }),
          fetchRashStats(),
          fetchRashThresholds(),
        ]);
        setItems(page.items);
        setTotal(page.total);
        setStats(st);
        setThresholds(th);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [backend, search, formFilter, offset]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    const raw = searchParams.get("kod") ?? searchParams.get("q");
    if (!raw || !backend) return;
    const kod = Number(raw);
    if (!Number.isFinite(kod) || kod < 0) return;
    if (selected?.kod === kod) return;
    let cancelled = false;
    void (async () => {
      try {
        const fromList = items.find((r) => r.kod === kod);
        const rule = fromList ?? (await fetchRashRule(kod));
        if (!cancelled && rule) await loadDetail({ ...EMPTY_RULE, ...rule });
      } catch {
        /* ignore missing kod */
      }
    })();
    return () => {
      cancelled = true;
    };
    // loadDetail is stable enough via selected guard; avoid re-open loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, items, searchParams, selected?.kod]);

  useEffect(() => {
    void loadCatalog()
      .then(setCatalog)
      .catch(() => setCatalog(null));
  }, []);

  const ensureSchema = useCallback(async (formId: string) => {
    if (!formId || schemas[formId]) return schemas[formId];
    try {
      const s = await loadSchema(formId);
      setSchemas((prev) => ({ ...prev, [formId]: s }));
      return s;
    } catch {
      return undefined;
    }
  }, [schemas]);

  const composedRule = useMemo(() => {
    const withRefs = applyRefsToRule(draft, refs);
    return {
      ...withRefs,
      totalFormula: buildFormulaString(formula),
    };
  }, [draft, refs, formula]);

  const dirty = useMemo(() => {
    const fp = draftFingerprint({
      draft: composedRule,
      addsum: addsumDraft,
      placements: placementsDraft,
    });
    return !!savedFingerprint && fp !== savedFingerprint;
  }, [composedRule, addsumDraft, placementsDraft, savedFingerprint]);

  const validation = useMemo(
    () =>
      validateRashDraft({
        isNew: !selected,
        draft: composedRule,
        formula,
        refs,
        addsum: addsumDraft,
        placements: placementsDraft,
        schemas,
      }),
    [composedRule, formula, refs, addsumDraft, placementsDraft, schemas, selected]
  );
  const hasErrors = validation.some((v) => v.level === "error");

  const markSaved = (
    rule: RashRule,
    addsum: RashAddsum[],
    placements: PlacementDraft[]
  ) => {
    setSavedFingerprint(
      draftFingerprint({
        draft: rule,
        addsum,
        placements,
      })
    );
  };

  const loadDetail = async (rule: RashRule) => {
    setSelected(rule);
    setTab("wizard");
    setWizardStep(1);
    if (!backend) return;
    setDetailLoading(true);
    setError("");
    try {
      const full = await fetchRashRule(rule.kod);
      const places = await fetchRashPlacements(rule.kod);
      const nextDraft = { ...EMPTY_RULE, ...full };
      const nextAddsum = full.addsum ?? [];
      const nextPlaces = places.map((p) => ({
        formId: p.formId,
        rowNo: p.rowNo,
        columnKey: p.columnKey,
      }));
      setDraft(nextDraft);
      setRefs(refsFromRule(nextDraft));
      setFormula(parseFormulaDraft(nextDraft.totalFormula));
      setAddsumDraft(nextAddsum);
      setPlacementsDraft(nextPlaces);
      markSaved(
        { ...nextDraft, totalFormula: nextDraft.totalFormula ?? null },
        nextAddsum,
        nextPlaces
      );
      for (const p of nextPlaces) {
        if (p.formId) void ensureSchema(p.formId);
      }
      const u = await fetchRashUsage(rule.kod);
      setUsage(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки правила");
      setUsage(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleNew = async () => {
    setSelected(null);
    setUsage(null);
    setTab("wizard");
    setWizardStep(1);
    let kod = 90001;
    if (backend) {
      try {
        kod = (await fetchNextRashKod()).kod;
      } catch {
        /* keep default */
      }
    }
    const next = { ...EMPTY_RULE, kod };
    setDraft(next);
    setRefs([emptyRefSpec("Контрагент"), emptyRefSpec(""), emptyRefSpec(""), emptyRefSpec("")]);
    setFormula(emptyFormula());
    setAddsumDraft([]);
    setPlacementsDraft([]);
    markSaved(next, [], []);
  };

  const handleSaveAll = async (forceConflicts = false) => {
    if (!backend) {
      setError("Редактирование доступно при подключении к API");
      return;
    }
    if (hasErrors) {
      setError("Исправьте ошибки валидации перед сохранением");
      return;
    }
    try {
      const saved = await saveRashBundle({
        rule: composedRule,
        addsum: addsumDraft.map((a, i) => ({
          kod: composedRule.kod,
          sort: a.sort ?? i,
          sumTitle: a.sumTitle,
          fldType: a.fldType || "Сумма",
        })),
        placements: placementsDraft,
        forceConflicts,
      });
      clearRowRashIndexCache();
      setDraft(saved.rule);
      setRefs(refsFromRule(saved.rule));
      setFormula(parseFormulaDraft(saved.rule.totalFormula));
      setAddsumDraft(saved.addsum);
      const places = saved.placements.map((p: RashPlacement) => ({
        formId: p.formId,
        rowNo: p.rowNo,
        columnKey: p.columnKey,
      }));
      setPlacementsDraft(places);
      setSelected(saved.rule);
      markSaved(saved.rule, saved.addsum, places);
      setStatus(
        forceConflicts
          ? `Сохранено с перезаписью конфликтов (код ${saved.rule.kod})`
          : `Сохранено целиком: правило ${saved.rule.kod}`
      );
      setError("");
      await loadPage();
      setUsage(await fetchRashUsage(saved.rule.kod));
    } catch (e) {
      const conflicts = (e as { conflicts?: Array<{ existingKod: number }> }).conflicts;
      if (conflicts?.length) {
        const ok = confirm(
          `${e instanceof Error ? e.message : "Конфликт привязок"}\n\nПерезаписать чужие привязки?`
        );
        if (ok) await handleSaveAll(true);
        else setError(e instanceof Error ? e.message : "Конфликт");
        return;
      }
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    }
  };

  const handleDiscard = () => {
    if (selected) void loadDetail(selected);
    else void handleNew();
  };

  const handleDelete = async () => {
    if (!selected || !backend) return;
    const u = usage ?? (await fetchRashUsage(selected.kod).catch(() => null));
    const warn =
      u && (u.entryCount > 0 || u.placementCount > 0)
        ? `\nИспользуется: привязок ${u.placementCount}, строк расшифровок ${u.entryCount} в ${u.instanceCount} комплектах.`
        : "";
    if (
      !confirm(
        `Удалить расшифровку ${selected.kod} вместе с доп. графами и привязками?${warn}`
      )
    )
      return;
    try {
      await deleteRashRule(selected.kod);
      clearRowRashIndexCache();
      await handleNew();
      setStatus("Удалено");
      await loadPage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const handleImportPreview = async (kind: "rules" | "placements") => {
    if (!backend) return;
    try {
      const data =
        kind === "rules"
          ? await previewRashRulesImport()
          : await previewRashPlacementsImport();
      setImportPreview({ kind, data });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка предпросмотра импорта");
    }
  };

  const handleConfirmImport = async () => {
    if (!importPreview || !backend) return;
    try {
      if (importPreview.kind === "rules") {
        const { reimported } = await reimportRashFromJson();
        setStatus(`Импортировано правил: ${reimported}`);
      } else {
        const { reimported } = await reimportRashPlacementsFromJson();
        clearRowRashIndexCache();
        setStatus(`Импортировано привязок: ${reimported}`);
      }
      setImportPreview(null);
      await handleNew();
      await loadPage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка импорта");
    }
  };

  const formIds = useMemo(() => {
    if (!catalog) return [] as string[];
    return catalog.forms.map((f) => f.id).sort();
  }, [catalog]);

  const primaryFormId =
    placementsDraft[0]?.formId ||
    formFilter ||
    (draft.name.includes("_") ? draft.name.split("_").slice(0, 2).join("_") : "");

  useEffect(() => {
    if (primaryFormId) void ensureSchema(primaryFormId);
  }, [primaryFormId, ensureSchema]);

  const primarySchema = primaryFormId ? schemas[primaryFormId] : undefined;
  const numberCols =
    primarySchema?.columns.filter((c) => c.type === "number" && c.key !== "num") ?? [];

  const updateRef = (idx: 0 | 1 | 2 | 3, patch: Partial<RefSpecDraft>) => {
    setRefs((prev) => {
      const next = [...prev] as [RefSpecDraft, RefSpecDraft, RefSpecDraft, RefSpecDraft];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  const modeHint = SPECIAL_MODES[draft.kod];

  const renderRefEditor = (idx: 0 | 1 | 2 | 3, label: string) => {
    const spec = refs[idx];
    return (
      <div className="rash-ref-card" key={idx}>
        <h4>{label}</h4>
        <div className="checks-form-grid">
          <label>
            Справочник
            <select
              value={spec.kind}
              onChange={(e) => updateRef(idx, { kind: e.target.value })}
            >
              <option value="">— не используется —</option>
              {REF_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          {spec.kind === "Прочее" && (
            <label>
              Имя справочника
              <input
                value={spec.customKind}
                onChange={(e) => updateRef(idx, { customKind: e.target.value })}
              />
            </label>
          )}
          <label className="full-width">
            Заголовок колонки
            <input
              value={spec.title}
              placeholder={spec.kind || "Заголовок"}
              onChange={(e) => updateRef(idx, { title: e.target.value })}
            />
          </label>
          {spec.kind === "Контрагент" && (
            <div className="full-width rash-type-flags">
              <span>Типы контрагентов:</span>
              {[
                [1, "Внутригрупповые"],
                [2, "Ассоциированные"],
                [3, "Внешние"],
              ].map(([t, title]) => (
                <label key={t as number} className="rash-check">
                  <input
                    type="checkbox"
                    checked={spec.types.includes(t as number)}
                    onChange={() =>
                      updateRef(idx, { types: toggleType(spec.types, t as number) })
                    }
                  />
                  {title as string}
                </label>
              ))}
            </div>
          )}
          {spec.kind && spec.kind !== "Контрагент" && (
            <label className="full-width">
              Коды фильтра (через запятую)
              <input
                value={spec.codes.join(",")}
                placeholder="RU,AM или 116,104"
                onChange={(e) =>
                  updateRef(idx, {
                    codes: e.target.value
                      .split(",")
                      .map((x) => x.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
          )}
          <p className="tools-hint full-width">
            Access-строка: <code>{buildRefName(spec) || "—"}</code>
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="admin-editor-page rash-constructor-page">
      <h1>Конструктор расшифровок</h1>
      <p className="tools-intro">
        Мастер методологии: форма → строки/графы → справочники → итог → предпросмотр → сохранить
        всё. Заполнение контрагентов на отчётной форме — через кнопку «…».
      </p>

      {!backend && (
        <div className="status-bar">Режим только чтения. Подключите API для редактирования.</div>
      )}
      {status && <div className="status-bar">{status}</div>}
      {error && <div className="error-box">{error}</div>}
      {dirty && (
        <div className="status-bar warn-bar">Есть несохранённые изменения</div>
      )}

      {stats && (
        <p className="tools-hint">
          Правил: <strong>{stats.total}</strong>, с формулой итога:{" "}
          <strong>{stats.withFormula}</strong>, доп. граф: <strong>{stats.addsum}</strong>
        </p>
      )}

      {thresholds && (
        <section className="tools-section">
          <h2>Пороги обязательной расшифровки (тыс. руб.)</h2>
          <div className="tools-grid">
            <label>
              Уровень 1 ({thresholds.labels[0]})
              <input
                type="number"
                value={thresholds.level1}
                onChange={(e) => setThresholds({ ...thresholds, level1: Number(e.target.value) })}
              />
            </label>
            <label>
              Уровень 2 ({thresholds.labels[1]})
              <input
                type="number"
                value={thresholds.level2}
                onChange={(e) => setThresholds({ ...thresholds, level2: Number(e.target.value) })}
              />
            </label>
            <label>
              Уровень 3 ({thresholds.labels[2]})
              <input
                type="number"
                value={thresholds.level3}
                onChange={(e) => setThresholds({ ...thresholds, level3: Number(e.target.value) })}
              />
            </label>
          </div>
          {backend && adminOk && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                void saveRashThresholds(thresholds)
                  .then(() => setStatus("Пороги сохранены"))
                  .catch((e) => setError(e instanceof Error ? e.message : "Ошибка"))
              }
            >
              Сохранить пороги
            </button>
          )}
        </section>
      )}

      <div className="checks-toolbar">
        <input
          placeholder="Поиск…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
        />
        <select
          value={formFilter}
          onChange={(e) => {
            setFormFilter(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">Все формы</option>
          {formIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        {backend && adminOk && (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => void handleImportPreview("rules")}>
              Импорт правил…
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleImportPreview("placements")}
            >
              Импорт привязок…
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void handleNew()}>
              Новое правило
            </button>
          </>
        )}
      </div>

      <div className="checks-editor-layout rash-constructor-layout">
        <div className="checks-list-panel">
          {loading ? (
            <div className="loading">Загрузка…</div>
          ) : (
            <table className="checks-table">
              <thead>
                <tr>
                  <th>Код</th>
                  <th>Тип / форма</th>
                  <th>Итог</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr
                    key={r.kod}
                    className={selected?.kod === r.kod ? "selected" : undefined}
                    onClick={() => void loadDetail(r)}
                  >
                    <td>{r.kod}</td>
                    <td>{r.name}</td>
                    <td>{parseTotalColumn(r.totalFormula) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="toolbar-actions" style={{ marginTop: "0.5rem" }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              ←
            </button>
            <span className="muted">
              {offset + 1}–{Math.min(offset + limit, total)} / {total}
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={offset + limit >= total}
              onClick={() => setOffset(offset + limit)}
            >
              →
            </button>
          </div>
        </div>

        <div className="checks-detail-panel">
          {detailLoading && <div className="loading">Загрузка правила…</div>}

          <div className="rash-tab-row">
            {(
              [
                ["wizard", "Мастер"],
                ["rule", "Правило"],
                ["addsum", "Доп. графы"],
                ["placements", "Привязки"],
                ["usage", "Использование"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`btn ${tab === id ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setTab(id)}
                disabled={id === "usage" && !selected}
              >
                {label}
              </button>
            ))}
          </div>

          {modeHint && (
            <p className="tools-hint">
              Специальный режим (код {draft.kod}): <strong>{modeHint}</strong>
            </p>
          )}

          {validation.length > 0 && (
            <ul className="rash-validation">
              {validation.map((v, i) => (
                <li key={i} className={v.level === "error" ? "err" : "warn"}>
                  {v.level === "error" ? "Ошибка" : "Внимание"}: {v.message}
                </li>
              ))}
            </ul>
          )}

          {(tab === "wizard" || tab === "rule") && (
            <>
              {tab === "wizard" && (
                <div className="rash-wizard-steps">
                  {[1, 2, 3, 4, 5, 6].map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`btn ${wizardStep === s ? "btn-primary" : "btn-secondary"}`}
                      onClick={() => setWizardStep(s as WizardStep)}
                    >
                      {s}
                    </button>
                  ))}
                  <span className="muted">
                    {
                      [
                        "",
                        "Форма и код",
                        "Строки и графы",
                        "Справочники",
                        "Итог и доп. графы",
                        "Предпросмотр",
                        "Сохранение",
                      ][wizardStep]
                    }
                  </span>
                </div>
              )}

              {(tab === "rule" || wizardStep === 1) && (
                <div className="checks-form-grid">
                  <label>
                    Код расшифровки
                    <input
                      type="number"
                      value={draft.kod || ""}
                      disabled={!!selected}
                      onChange={(e) => setDraft({ ...draft, kod: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    Тип / название
                    <input
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      placeholder="N01_1_1105"
                    />
                  </label>
                  <label className="full-width">
                    Примечание
                    <input
                      value={draft.note ?? ""}
                      onChange={(e) => setDraft({ ...draft, note: e.target.value || null })}
                    />
                  </label>
                  {advanced && (
                    <label className="full-width">
                      Legacy refRows (Access)
                      <input
                        value={draft.refRows ?? ""}
                        onChange={(e) => setDraft({ ...draft, refRows: e.target.value || null })}
                        placeholder="лучше используйте вкладку Привязки"
                      />
                    </label>
                  )}
                  <label className="full-width rash-check">
                    <input
                      type="checkbox"
                      checked={advanced}
                      onChange={(e) => setAdvanced(e.target.checked)}
                    />
                    Расширенный режим (сырые Access-поля)
                  </label>
                </div>
              )}

              {(tab === "rule" || wizardStep === 2) && (
                <section className="tools-section">
                  <h2>Привязки к ячейкам</h2>
                  <p className="tools-hint">
                    Выберите форму и строки из шаблона — без ручного набора id.
                  </p>
                  <PlacementEditor
                    formIds={formIds}
                    schemas={schemas}
                    ensureSchema={ensureSchema}
                    placements={placementsDraft}
                    onChange={setPlacementsDraft}
                    preferFormId={primaryFormId}
                  />
                </section>
              )}

              {(tab === "rule" || wizardStep === 3) && (
                <section className="tools-section">
                  <h2>Справочники окна</h2>
                  {renderRefEditor(0, "Измерение 1")}
                  {renderRefEditor(1, "Измерение 2")}
                  {renderRefEditor(2, "Измерение 3")}
                  {renderRefEditor(3, "Измерение 4")}
                </section>
              )}

              {(tab === "rule" || wizardStep === 4) && (
                <section className="tools-section">
                  <h2>Формула итога</h2>
                  <FormulaEditor
                    formula={formula}
                    columns={numberCols}
                    onChange={setFormula}
                  />
                  <h3>Дополнительные графы</h3>
                  <AddsumEditor items={addsumDraft} kod={draft.kod} onChange={setAddsumDraft} />
                </section>
              )}

              {(tab === "wizard" && wizardStep === 5) || tab === "rule" ? (
                <section className="tools-section rash-preview">
                  <h2>Предпросмотр</h2>
                  <RashLivePreview
                    rule={composedRule}
                    refs={refs}
                    formula={formula}
                    addsum={addsumDraft}
                    placements={placementsDraft}
                    schema={primarySchema}
                  />
                </section>
              ) : null}

              {(tab === "wizard" && wizardStep === 6) || tab === "rule" ? (
                <div className="toolbar-actions" style={{ marginTop: "1rem" }}>
                  {backend && adminOk && (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={hasErrors}
                        onClick={() => void handleSaveAll()}
                      >
                        Сохранить всё
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={!dirty}
                        onClick={handleDiscard}
                      >
                        Отменить изменения
                      </button>
                      {selected && (
                        <button type="button" className="btn btn-danger" onClick={() => void handleDelete()}>
                          Удалить
                        </button>
                      )}
                    </>
                  )}
                </div>
              ) : null}

              {tab === "wizard" && wizardStep < 6 && (
                <div className="toolbar-actions" style={{ marginTop: "0.75rem" }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={wizardStep <= 1}
                    onClick={() => setWizardStep((wizardStep - 1) as WizardStep)}
                  >
                    Назад
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setWizardStep((wizardStep + 1) as WizardStep)}
                  >
                    Далее
                  </button>
                </div>
              )}
            </>
          )}

          {tab === "addsum" && (
            <AddsumEditor items={addsumDraft} kod={draft.kod} onChange={setAddsumDraft} />
          )}

          {tab === "placements" && (
            <PlacementEditor
              formIds={formIds}
              schemas={schemas}
              ensureSchema={ensureSchema}
              placements={placementsDraft}
              onChange={setPlacementsDraft}
              preferFormId={primaryFormId}
            />
          )}

          {tab === "usage" && usage && (
            <section className="tools-section">
              <h2>Использование кода {usage.kod}</h2>
              <p>
                Привязок: <strong>{usage.placementCount}</strong> · форм:{" "}
                <strong>{usage.forms.length}</strong> · строк расшифровок в БД:{" "}
                <strong>{usage.entryCount}</strong> · комплектов:{" "}
                <strong>{usage.instanceCount}</strong>
              </p>
              <p className="tools-hint">Формы: {usage.forms.join(", ") || "—"}</p>
              <table className="checks-table">
                <thead>
                  <tr>
                    <th>Форма</th>
                    <th>Строка</th>
                    <th>Графа</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.samplePlacements.map((p, i) => (
                    <tr key={i}>
                      <td>{p.formId}</td>
                      <td>{p.rowNo}</td>
                      <td>{p.columnKey || "*"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {tab !== "wizard" && backend && adminOk && (
            <div className="toolbar-actions" style={{ marginTop: "1rem" }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={hasErrors}
                onClick={() => void handleSaveAll()}
              >
                Сохранить всё
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!dirty}
                onClick={handleDiscard}
              >
                Отменить изменения
              </button>
            </div>
          )}
        </div>
      </div>

      {importPreview && (
        <div className="rash-modal-backdrop" role="presentation" onClick={() => setImportPreview(null)}>
          <div className="rash-modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <header className="rash-modal-header">
              <h2>
                Предпросмотр импорта{" "}
                {importPreview.kind === "rules" ? "правил" : "привязок"}
              </h2>
              <button type="button" className="btn-icon" onClick={() => setImportPreview(null)}>
                ×
              </button>
            </header>
            <ImportDiffBody kind={importPreview.kind} data={importPreview.data} />
            <div className="toolbar-actions" style={{ marginTop: "1rem" }}>
              <button type="button" className="btn btn-danger" onClick={() => void handleConfirmImport()}>
                Применить импорт (перезапись)
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setImportPreview(null)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FormulaEditor({
  formula,
  columns,
  onChange,
}: {
  formula: FormulaDraft;
  columns: Array<{ key: string; label: string }>;
  onChange: (f: FormulaDraft) => void;
}) {
  const preview = buildFormulaString(formula);
  return (
    <div className="rash-formula-editor">
      <label className="rash-check">
        <input
          type="checkbox"
          checked={formula.rawMode}
          onChange={(e) => onChange({ ...formula, rawMode: e.target.checked })}
        />
        Сырая формула Access
      </label>
      {formula.rawMode ? (
        <input
          value={formula.raw}
          placeholder="L=B+C+D−F"
          onChange={(e) => onChange({ ...formula, raw: e.target.value })}
        />
      ) : (
        <>
          <label>
            Итоговая графа
            <select
              value={formula.totalCol}
              onChange={(e) => onChange({ ...formula, totalCol: e.target.value })}
            >
              <option value="">—</option>
              {columns.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.key} — {c.label}
                </option>
              ))}
            </select>
          </label>
          <div className="rash-formula-terms">
            {formula.terms.map((t, idx) => (
              <div key={idx} className="rash-formula-term">
                <select
                  value={t.sign}
                  onChange={(e) => {
                    const terms = [...formula.terms];
                    terms[idx] = { ...t, sign: e.target.value as "+" | "-" };
                    onChange({ ...formula, terms });
                  }}
                >
                  <option value="+">+</option>
                  <option value="-">−</option>
                </select>
                <select
                  value={t.col}
                  onChange={(e) => {
                    const terms = [...formula.terms];
                    terms[idx] = { ...t, col: e.target.value };
                    onChange({ ...formula, terms });
                  }}
                >
                  <option value="">—</option>
                  {columns.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.key}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() =>
                    onChange({ ...formula, terms: formula.terms.filter((_, i) => i !== idx) })
                  }
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() =>
              onChange({ ...formula, terms: [...formula.terms, { sign: "+", col: "" }] })
            }
          >
            Добавить слагаемое
          </button>
        </>
      )}
      <p className="tools-hint">
        Формула: <code>{preview || "—"}</code>
      </p>
      {!formula.rawMode && formula.totalCol && formula.terms.length > 0 && (
        <p className="tools-hint">
          Тест: если{" "}
          {formula.terms.map((t) => `${t.col}=1`).join(", ")}, итог{" "}
          {formula.terms.reduce((s, t) => s + (t.sign === "-" ? -1 : 1), 0)} → гр. {formula.totalCol}
        </p>
      )}
    </div>
  );
}

function AddsumEditor({
  items,
  kod,
  onChange,
}: {
  items: RashAddsum[];
  kod: number;
  onChange: (items: RashAddsum[]) => void;
}) {
  return (
    <>
      <table className="checks-table">
        <thead>
          <tr>
            <th>Порядок</th>
            <th>Заголовок</th>
            <th>Тип</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((row, idx) => (
            <tr key={idx}>
              <td>
                <input
                  type="number"
                  value={row.sort}
                  style={{ width: "4rem" }}
                  onChange={(e) => {
                    const next = [...items];
                    next[idx] = { ...row, sort: Number(e.target.value) };
                    onChange(next);
                  }}
                />
              </td>
              <td>
                <input
                  value={row.sumTitle}
                  onChange={(e) => {
                    const next = [...items];
                    next[idx] = { ...row, sumTitle: e.target.value };
                    onChange(next);
                  }}
                />
              </td>
              <td>
                <select
                  value={row.fldType}
                  onChange={(e) => {
                    const next = [...items];
                    next[idx] = { ...row, fldType: e.target.value };
                    onChange(next);
                  }}
                >
                  {SUPPORTED_FLD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                  <option value="Текст">Текст (ограничено)</option>
                  <option value="Дата">Дата (ограничено)</option>
                </select>
              </td>
              <td>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onChange(items.filter((_, i) => i !== idx))}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="btn btn-secondary"
        style={{ marginTop: "0.5rem" }}
        onClick={() =>
          onChange([
            ...items,
            { kod, sort: items.length, sumTitle: "", fldType: "Сумма" },
          ])
        }
      >
        Добавить графу
      </button>
    </>
  );
}

function PlacementEditor({
  formIds,
  schemas,
  ensureSchema,
  placements,
  onChange,
  preferFormId,
}: {
  formIds: string[];
  schemas: Record<string, FormSchema>;
  ensureSchema: (id: string) => Promise<FormSchema | undefined>;
  placements: PlacementDraft[];
  onChange: (p: PlacementDraft[]) => void;
  preferFormId?: string;
}) {
  const [pickForm, setPickForm] = useState(preferFormId || "");
  const [pickedRows, setPickedRows] = useState<string[]>([]);
  const [pickedCols, setPickedCols] = useState<string[]>([]);

  useEffect(() => {
    if (preferFormId && !pickForm) setPickForm(preferFormId);
  }, [preferFormId, pickForm]);

  useEffect(() => {
    if (pickForm) void ensureSchema(pickForm);
  }, [pickForm, ensureSchema]);

  const schema = pickForm ? schemas[pickForm] : undefined;
  const rows = schema?.rows ?? [];
  const cols = schema?.columns.filter((c) => c.type === "number" && c.key !== "num") ?? [];

  const addFromPicker = () => {
    if (!pickForm || pickedRows.length === 0) return;
    const next = [...placements];
    const colKeys = pickedCols.length ? pickedCols : [""];
    for (const rowNo of pickedRows) {
      for (const columnKey of colKeys) {
        const exists = next.some(
          (p) =>
            p.formId === pickForm &&
            p.rowNo === rowNo &&
            (p.columnKey || "").toUpperCase() === columnKey.toUpperCase()
        );
        if (!exists) next.push({ formId: pickForm, rowNo, columnKey });
      }
    }
    onChange(next);
    setPickedRows([]);
  };

  return (
    <div className="rash-placement-editor">
      <div className="checks-form-grid">
        <label>
          Форма
          <select
            value={pickForm}
            onChange={(e) => {
              setPickForm(e.target.value);
              setPickedRows([]);
              setPickedCols([]);
            }}
          >
            <option value="">— выберите —</option>
            {formIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label className="full-width">
          Строки (множественный выбор)
          <select
            multiple
            size={8}
            value={pickedRows}
            onChange={(e) =>
              setPickedRows(Array.from(e.target.selectedOptions).map((o) => o.value))
            }
          >
            {rows.map((r) => (
              <option key={String(r.num)} value={String(r.num ?? "")}>
                {r.num} — {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="full-width">
          Графы (пусто = вся строка)
          <select
            multiple
            size={6}
            value={pickedCols}
            onChange={(e) =>
              setPickedCols(Array.from(e.target.selectedOptions).map((o) => o.value))
            }
          >
            {cols.map((c) => (
              <option key={c.key} value={c.key}>
                {c.key} — {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button type="button" className="btn btn-secondary" onClick={addFromPicker}>
        Добавить выбранные привязки
      </button>

      <table className="checks-table" style={{ marginTop: "0.75rem" }}>
        <thead>
          <tr>
            <th>Форма</th>
            <th>Строка</th>
            <th>Графа</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {placements.map((row, idx) => (
            <tr key={`${row.formId}-${row.rowNo}-${row.columnKey}-${idx}`}>
              <td>{row.formId}</td>
              <td>{row.rowNo}</td>
              <td>{row.columnKey || "*"}</td>
              <td>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onChange(placements.filter((_, i) => i !== idx))}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {placements.length === 0 && <p className="tools-hint">Привязок пока нет.</p>}
    </div>
  );
}

function RashLivePreview({
  rule,
  refs,
  formula,
  addsum,
  placements,
  schema,
}: {
  rule: RashRule;
  refs: [RefSpecDraft, RefSpecDraft, RefSpecDraft, RefSpecDraft];
  formula: FormulaDraft;
  addsum: RashAddsum[];
  placements: PlacementDraft[];
  schema?: FormSchema;
}) {
  const formulaStr = buildFormulaString(formula);
  const dims = refs
    .map((r, i) => ({ title: r.title || r.kind || `A${i + 1}`, name: buildRefName(r) }))
    .filter((d) => d.name);
  return (
    <div>
      <p className="tools-hint">
        Код <strong>{rule.kod}</strong> · {rule.name || "без названия"} · формула{" "}
        <code>{formulaStr || "—"}</code>
      </p>
      <div className="table-wrap">
        <table className="form-table">
          <thead>
            <tr>
              {dims.map((d) => (
                <th key={d.title}>{d.title}</th>
              ))}
              {(formula.rawMode
                ? []
                : formula.terms.map((t) => t.col).filter(Boolean)
              ).map((c) => (
                <th key={c}>{c}</th>
              ))}
              {formula.totalCol && <th>{formula.totalCol} (итог)</th>}
              {addsum.map((a) => (
                <th key={a.sort}>{a.sumTitle || `+${a.sort}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {dims.map((d) => (
                <td key={d.title} className="muted">
                  {d.name}
                </td>
              ))}
              {(formula.rawMode ? [] : formula.terms.map((t) => t.col).filter(Boolean)).map((c) => (
                <td key={c}>0</td>
              ))}
              {formula.totalCol && <td>0</td>}
              {addsum.map((a) => (
                <td key={a.sort}>0</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="tools-hint" style={{ marginTop: "0.75rem" }}>
        Кнопка «…» появится на{" "}
        {placements.length
          ? placements
              .slice(0, 8)
              .map((p) => `${p.formId}:${p.rowNo}:${p.columnKey || "*"}`)
              .join(", ") + (placements.length > 8 ? "…" : "")
          : "— (нет привязок)"}
      </p>
      {schema && (
        <p className="tools-hint">
          Шаблон {schema.id}: {schema.rows.length} строк,{" "}
          {schema.columns.filter((c) => c.type === "number").length} числовых граф
        </p>
      )}
    </div>
  );
}

function ImportDiffBody({ kind, data }: { kind: "rules" | "placements"; data: unknown }) {
  if (kind === "rules") {
    const d = data as {
      added: number[];
      removed: number[];
      changed: number[];
      unchanged: number;
      jsonTotal: number;
      dbTotal: number;
    };
    return (
      <div>
        <p>
          JSON: {d.jsonTotal} · БД: {d.dbTotal} · без изменений: {d.unchanged}
        </p>
        <p>
          <strong>Новые ({d.added.length}):</strong> {d.added.slice(0, 30).join(", ") || "—"}
        </p>
        <p>
          <strong>Изменённые ({d.changed.length}):</strong>{" "}
          {d.changed.slice(0, 30).join(", ") || "—"}
        </p>
        <p>
          <strong>Удаляемые ({d.removed.length}):</strong>{" "}
          {d.removed.slice(0, 30).join(", ") || "—"}
        </p>
        <p className="tools-hint">
          Импорт полностью перезапишет правила из rash-rules.json. Привязки, зависшие на CASCADE,
          могут потребовать повторного импорта привязок.
        </p>
      </div>
    );
  }
  const d = data as {
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
    jsonTotal: number;
    dbTotal: number;
    sampleConflicts: Array<{
      formId: string;
      rowNo: string;
      columnKey: string;
      existingKod: number;
    }>;
  };
  return (
    <div>
      <p>
        JSON: {d.jsonTotal} · БД: {d.dbTotal}
      </p>
      <p>
        +{d.added} / Δ{d.changed} / −{d.removed} / ={d.unchanged}
      </p>
      {d.sampleConflicts.length > 0 && (
        <p className="tools-hint">
          Примеры смен кода:{" "}
          {d.sampleConflicts
            .slice(0, 8)
            .map((c) => `${c.formId}/${c.rowNo}/${c.columnKey || "*"}←${c.existingKod}`)
            .join("; ")}
        </p>
      )}
    </div>
  );
}
