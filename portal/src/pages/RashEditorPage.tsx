import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  deleteRashRule,
  fetchNextRashKod,
  fetchRashPage,
  fetchRashRule,
  fetchRashStats,
  fetchRashThresholds,
  fetchRashUsage,
  loadCatalog,
  loadSchema,
  previewRashPlacementsImport,
  previewRashBundleStructure,
  previewRashRulesImport,
  reimportRashFromJson,
  reimportRashPlacementsFromJson,
  saveRashBundle,
  saveRashThresholds,
  type RashFormAddition,
  type RashListItem,
  type RashPlacement,
  type RashRule,
} from "../api";
import { clearRowRashIndexCache } from "../engine/rowRashIndex";
import { clearRashCache } from "../engine/rashEngine";
import { parseTotalColumn } from "../engine/rashEngine";
import type {
  FormCatalog,
  FormSchema,
  RashAddsum,
  RashModalRow,
  RashModalSettings,
  RashThresholds,
} from "../types";
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
  stepHasErrors,
  SUPPORTED_FLD_TYPES,
  validateRashDraft,
  type PlacementDraft,
  type RashWizardStep,
} from "./rashEditor/validateDraft";
import { ColumnKeyInput } from "./rashEditor/ColumnKeyInput";
import { BindingDesigner } from "./rashEditor/BindingDesigner";
import { ModalRowsEditor } from "./rashEditor/ModalRowsEditor";
import { RashEditorModal } from "../components/RashEditorModal";
import {
  buildRashModalLayout,
  seedRashEntriesFromModalLayout,
} from "../engine/rashEngine";

const EMPTY_RULE: RashRule = {
  kod: 0,
  name: "",
  isActive: true,
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

type WizardStep = RashWizardStep;

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [stats, setStats] = useState<{
    total: number;
    addsum: number;
    withFormula: number;
  } | null>(null);
  const [thresholds, setThresholds] = useState<RashThresholds | null>(null);
  const [items, setItems] = useState<RashListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState(
    () => searchParams.get("kod") ?? searchParams.get("q") ?? ""
  );
  const [search, setSearch] = useState(searchInput);
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
  const [modalSettings, setModalSettings] = useState<RashModalSettings>({
    rowMode: "dynamic",
  });
  const [modalRows, setModalRows] = useState<RashModalRow[]>([]);
  const [formAdditions, setFormAdditions] = useState<RashFormAddition[]>([]);
  const [savedFingerprint, setSavedFingerprint] = useState("");
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
    const timer = window.setTimeout(() => {
      setSearch(searchInput);
      setOffset(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

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
      modalSettings,
      modalRows,
    });
    return !!savedFingerprint && fp !== savedFingerprint;
  }, [
    composedRule,
    addsumDraft,
    placementsDraft,
    modalSettings,
    modalRows,
    savedFingerprint,
  ]);

  const validation = useMemo(
    () =>
      validateRashDraft({
        isNew: !selected,
        draft: composedRule,
        formula,
        refs,
        addsum: addsumDraft,
        placements: placementsDraft,
        modalSettings,
        modalRows,
        schemas,
      }),
    [
      composedRule,
      formula,
      refs,
      addsumDraft,
      placementsDraft,
      modalSettings,
      modalRows,
      schemas,
      selected,
    ]
  );
  const hasErrors = validation.some((v) => v.level === "error");
  const currentStepBlocked = stepHasErrors(validation, wizardStep);

  const markSaved = (
    rule: RashRule,
    addsum: RashAddsum[],
    placements: PlacementDraft[],
    settings: RashModalSettings = modalSettings,
    rows: RashModalRow[] = modalRows
  ) => {
    setSavedFingerprint(
      draftFingerprint({
        draft: rule,
        addsum,
        placements,
        modalSettings: settings,
        modalRows: rows,
      })
    );
  };

  const loadDetail = async (rule: RashRule) => {
    setSelected(rule);
    setWizardStep(1);
    if (!backend) return;
    setDetailLoading(true);
    setError("");
    try {
      const full = await fetchRashRule(rule.kod);
      const nextDraft = { ...EMPTY_RULE, ...full };
      const nextAddsum = full.addsum ?? [];
      const nextPlaces = (full.placements ?? []).map((p) => ({
        formId: p.formId,
        rowNo: p.rowNo,
        columnKey: p.columnKey,
      }));
      const nextSettings = full.modalSettings ?? { rowMode: "dynamic" as const };
      const nextModalRows = full.modalRows ?? [];
      setDraft(nextDraft);
      setRefs(refsFromRule(nextDraft));
      setFormula(parseFormulaDraft(nextDraft.totalFormula));
      setAddsumDraft(nextAddsum);
      setPlacementsDraft(nextPlaces);
      setModalSettings(nextSettings);
      setModalRows(nextModalRows);
      setFormAdditions([]);
      markSaved(
        { ...nextDraft, totalFormula: nextDraft.totalFormula ?? null },
        nextAddsum,
        nextPlaces,
        nextSettings,
        nextModalRows
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

  const handleNew = async (force = false) => {
    if (
      !force &&
      dirty &&
      !confirm("Есть несохранённые изменения. Создать новое правило и потерять их?")
    ) {
      return;
    }
    setSearchParams({});
    setSelected(null);
    setUsage(null);
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
    setModalSettings({ rowMode: "dynamic" });
    setModalRows([]);
    setFormAdditions([]);
    markSaved(next, [], [], { rowMode: "dynamic" }, []);
  };

  const handleSelectRule = async (rule: RashRule) => {
    if (
      dirty &&
      selected?.kod !== rule.kod &&
      !confirm("Есть несохранённые изменения. Перейти к другому правилу?")
    ) {
      return;
    }
    setSearchParams({ kod: String(rule.kod) });
    await loadDetail(rule);
  };

  const handleSaveAll = async (
    forceConflicts = false,
    createMissingFormParts = false
  ) => {
    if (!backend) {
      setError("Редактирование доступно при подключении к API");
      return;
    }
    if (hasErrors) {
      setError("Исправьте ошибки валидации перед сохранением");
      return;
    }
    try {
      if (!createMissingFormParts) {
        const structure = await previewRashBundleStructure({
          placements: placementsDraft,
          formAdditions,
        });
        if (structure.missingRows.length || structure.missingColumns.length) {
          const details = [
            ...structure.missingRows.map(
              (item) => `${item.formId}: строка ${item.rowNo} «${item.name}»`
            ),
            ...structure.missingColumns.map(
              (item) => `${item.formId}: графа ${item.columnKey} «${item.label}»`
            ),
          ].join("\n");
          if (
            !confirm(
              `В шаблонах форм отсутствуют элементы:\n\n${details}\n\nСоздать их и сохранить правило?`
            )
          ) {
            setError("Сохранение отменено: сначала создайте строки/графы или подтвердите создание");
            return;
          }
          return handleSaveAll(forceConflicts, true);
        }
      }
      const saved = await saveRashBundle({
        rule: composedRule,
        addsum: addsumDraft.map((a, i) => ({
          kod: composedRule.kod,
          sort: a.sort ?? i,
          sumTitle: a.sumTitle,
          fldType: a.fldType || "Сумма",
          required: a.required ?? false,
        })),
        placements: placementsDraft,
        modalSettings,
        modalRows: modalRows.map((row, index) => ({
          ...row,
          kod: composedRule.kod,
          sort: index,
        })),
        formAdditions,
        createMissingFormParts,
        forceConflicts,
      });
      clearRowRashIndexCache();
      clearRashCache();
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
      setModalSettings(saved.modalSettings);
      setModalRows(saved.modalRows);
      setFormAdditions([]);
      setSelected(saved.rule);
      markSaved(
        saved.rule,
        saved.addsum,
        places,
        saved.modalSettings,
        saved.modalRows
      );
      setSearch(String(saved.rule.kod));
      setOffset(0);
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
        if (ok) await handleSaveAll(true, createMissingFormParts);
        else setError(e instanceof Error ? e.message : "Конфликт");
        return;
      }
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    }
  };

  const handleDiscard = () => {
    if (selected) void loadDetail(selected);
    else void handleNew(true);
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
      clearRashCache();
      await handleNew(true);
      setStatus("Удалено");
      await loadPage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const handleImportPreview = async (kind: "rules" | "placements") => {
    if (!backend) return;
    if (
      dirty &&
      !confirm("Есть несохранённые изменения. Продолжить к импорту? Несохранённый черновик может быть сброшен.")
    ) {
      return;
    }
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
        clearRashCache();
        setStatus(`Импортировано правил: ${reimported}`);
      } else {
        const { reimported } = await reimportRashPlacementsFromJson();
        clearRowRashIndexCache();
        clearRashCache();
        setStatus(`Импортировано привязок: ${reimported}`);
      }
      setImportPreview(null);
      await handleNew(true);
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

  const previewEntries = useMemo(() => {
    if (!composedRule.kod) return [];
    const layout = buildRashModalLayout({
      rule: composedRule,
      formColumns: primarySchema?.columns ?? [],
      addsum: addsumDraft,
      placementColumns: placementsDraft
        .filter((p) => p.formId === primaryFormId)
        .map((p) => p.columnKey)
        .filter(Boolean),
      modalSettings,
      modalRows,
    });
    const seeded = seedRashEntriesFromModalLayout([], layout, {
      formId: primaryFormId || "PREVIEW",
      parentRowNo: Number(placementsDraft[0]?.rowNo) || 1,
      rashKod: composedRule.kod,
    });
    if (seeded.length > 0) {
      return seeded.map((entry, index) => ({
        ...entry,
        values:
          index === 0 && layout.columns[0]
            ? { [layout.columns[0].key]: 100 }
            : entry.values,
      }));
    }
    return [
      {
        formId: primaryFormId || "PREVIEW",
        parentRowNo: Number(placementsDraft[0]?.rowNo) || 1,
        columnKey: null as string | null,
        rashKod: composedRule.kod,
        lineNo: 0,
        kontrName: "Пример контрагента",
        values: {} as Record<string, string | number>,
      },
    ];
  }, [
    composedRule,
    primarySchema,
    addsumDraft,
    placementsDraft,
    primaryFormId,
    modalSettings,
    modalRows,
  ]);

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
          placeholder="Код или название…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <select
          value={formFilter}
          title="Включая правила с привязками к форме"
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

      <div className="checks-layout rash-constructor-layout">
        <div className="checks-list-panel">
          {loading ? (
            <div className="loading">Загрузка…</div>
          ) : (
            <div className="rash-rule-catalog">
              {items.map((r) => (
                <button
                  type="button"
                  key={r.kod}
                  className={`rash-rule-card${selected?.kod === r.kod ? " selected" : ""}`}
                  onClick={() => void handleSelectRule(r)}
                >
                  <span className="rash-rule-card-title">
                    <strong>№{r.kod}</strong> {r.name}
                  </span>
                  <span className="rash-rule-card-meta">
                    <span>{r.isActive === false ? "Выключено" : "Активно"}</span>
                    <span>{r.formIds.join(", ") || "Без формы"}</span>
                    <span>Привязок: {r.placementCount}</span>
                    <span>
                      Строки:{" "}
                      {r.rowMode === "dynamic"
                        ? "динамические"
                        : r.rowMode === "fixed"
                          ? `фиксированные (${r.fixedRowCount})`
                          : `смешанные (${r.fixedRowCount})`}
                    </span>
                    <span>
                      Итог: {parseTotalColumn(r.totalFormula) ?? "—"} · доп. полей:{" "}
                      {r.addsumCount}
                    </span>
                  </span>
                </button>
              ))}
            </div>
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

          <header className="rash-constructor-header">
            <div>
              <h2>{selected ? `Правило №${draft.kod}: ${draft.name}` : "Новое правило"}</h2>
              <span className={`status-badge ${draft.isActive === false ? "returned" : "accepted"}`}>
                {draft.isActive === false ? "Выключено" : "Активно"}
              </span>
              {dirty && <span className="rash-dirty-indicator">Есть несохранённые изменения</span>}
            </div>
            {modeHint && <span className="tools-hint">{modeHint}</span>}
          </header>

          <nav className="rash-wizard-steps" aria-label="Шаги конструктора">
            {[
              "Основное",
              "Где открывается",
              "Строки окна",
              "Графы окна",
              "Предпросмотр",
              "Проверка",
            ].map((label, index) => {
              const step = (index + 1) as WizardStep;
              return (
                <button
                  key={label}
                  type="button"
                  className={`btn ${wizardStep === step ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setWizardStep(step)}
                >
                  <span>{step}</span> {label}
                </button>
              );
            })}
          </nav>

          {wizardStep === 1 && (
            <section className="tools-section">
              <h2>1. Основное</h2>
              <p className="tools-hint">Название и статус правила, понятные пользователю.</p>
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
                  Название
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="Расчёты с контрагентами"
                  />
                </label>
                <label className="full-width">
                  Описание
                  <textarea
                    value={draft.note ?? ""}
                    onChange={(e) => setDraft({ ...draft, note: e.target.value || null })}
                    placeholder="Когда и зачем пользователь заполняет это окно"
                  />
                </label>
                <label className="full-width rash-check">
                  <input
                    type="checkbox"
                    checked={draft.isActive !== false}
                    onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
                  />
                  Правило активно и доступно в формах
                </label>
              </div>
            </section>
          )}

          {wizardStep === 2 && (
            <section className="tools-section">
              <h2>2. Где открывается окно</h2>
              <BindingDesigner
                formIds={formIds}
                schemas={schemas as Record<string, FormSchema>}
                ensureSchema={ensureSchema}
                placements={placementsDraft}
                additions={formAdditions}
                onChange={setPlacementsDraft}
                onAdditionsChange={setFormAdditions}
                preferFormId={primaryFormId}
                currentKod={draft.kod || selected?.kod}
                onOpenRule={(kod) => {
                  void handleSelectRule({ ...EMPTY_RULE, kod, name: `№${kod}` });
                }}
              />
            </section>
          )}

          {wizardStep === 3 && (
            <section className="tools-section">
              <h2>3. Строки внутри окна</h2>
              <ModalRowsEditor
                settings={modalSettings}
                rows={modalRows}
                schemas={schemas as Record<string, FormSchema>}
                primaryFormId={primaryFormId}
                onSettingsChange={setModalSettings}
                onRowsChange={setModalRows}
              />
            </section>
          )}

          {wizardStep === 4 && (
            <>
              <section className="tools-section">
                <h2>4. Графы внутри окна</h2>
                <h3>Справочники</h3>
                {renderRefEditor(0, "Контрагент или классификатор 1")}
                {renderRefEditor(1, "Классификатор 2")}
                {renderRefEditor(2, "Классификатор 3")}
                {renderRefEditor(3, "Классификатор 4")}
              </section>
              <section className="tools-section">
                <h3>Суммовые графы и перенос итога</h3>
                <FormulaEditor formula={formula} columns={numberCols} onChange={setFormula} />
              </section>
              <section className="tools-section">
                <h3>Дополнительные поля</h3>
                <AddsumEditor items={addsumDraft} kod={draft.kod} onChange={setAddsumDraft} />
              </section>
              <details className="tools-section">
                <summary>Совместимость с Access</summary>
                <label className="full-width">
                  refRows
                  <input
                    value={draft.refRows ?? ""}
                    onChange={(e) => setDraft({ ...draft, refRows: e.target.value || null })}
                  />
                </label>
                <label className="rash-check">
                  <input
                    type="checkbox"
                    checked={advanced}
                    onChange={(e) => setAdvanced(e.target.checked)}
                  />
                  Показывать сырую формулу
                </label>
              </details>
            </>
          )}

          {wizardStep === 5 && (
            <section className="tools-section rash-preview">
              <h2>5. Предпросмотр окна</h2>
              <div className="rash-preview-summary">
                <p>
                  Открывается из{" "}
                  <strong>{placementsDraft.length || "—"}</strong> ячеек · строки:{" "}
                  <strong>
                    {modalSettings.rowMode === "dynamic"
                      ? "динамические"
                      : modalSettings.rowMode === "fixed"
                        ? "фиксированные"
                        : "смешанные"}
                  </strong>
                  {modalRows.length ? ` (${modalRows.length})` : ""} · итог{" "}
                  <strong>{parseTotalColumn(composedRule.totalFormula) ?? "—"}</strong>
                </p>
              </div>
              <RashEditorModal
                open
                preview
                readOnly
                onClose={() => undefined}
                onSave={() => undefined}
                context={{
                  formId: primaryFormId || "PREVIEW",
                  parentRowNo: Number(placementsDraft[0]?.rowNo) || 1,
                  columnKey: placementsDraft[0]?.columnKey || "K",
                  rashKod: composedRule.kod || 0,
                  rule: composedRule,
                  parentLabel: composedRule.name || "Строка формы",
                  parentValue: 100,
                  placementColumns: placementsDraft
                    .filter((p) => p.formId === primaryFormId)
                    .map((p) => p.columnKey)
                    .filter(Boolean),
                }}
                entries={previewEntries}
                formColumns={primarySchema?.columns ?? numberCols}
                addsum={addsumDraft}
                kontrAgents={[]}
                modalSettings={modalSettings}
                modalRows={modalRows}
              />
            </section>
          )}

          {wizardStep === 6 && (
            <section className="tools-section">
              <h2>6. Проверка перед сохранением</h2>
              {validation.length === 0 ? (
                <p className="status-ok">Правило заполнено корректно и готово к сохранению.</p>
              ) : (
                <ul className="rash-validation">
                  {validation.map((v, i) => (
                    <li key={i} className={v.level === "error" ? "err" : "warn"}>
                      {v.level === "error" ? "Ошибка" : "Внимание"}: {v.message}
                      {v.step != null && (
                        <>
                          {" "}
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => setWizardStep(v.step!)}
                          >
                            к шагу {v.step}
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="rash-rule-summary">
                <p>
                  Открывается: <strong>{placementsDraft.length}</strong> ячеек в{" "}
                  <strong>{new Set(placementsDraft.map((item) => item.formId)).size}</strong> формах.
                </p>
                <p>
                  Строки окна: <strong>{modalSettings.rowMode}</strong>
                  {modalRows.length ? `, фиксированных: ${modalRows.length}` : ""}.
                </p>
                <p>
                  Дополнительных полей: <strong>{addsumDraft.length}</strong>.
                </p>
              </div>
              {usage && (
                <p className="tools-hint">
                  Уже используется: {usage.placementCount} привязок, {usage.entryCount} строк
                  расшифровок в {usage.instanceCount} комплектах.
                </p>
              )}
            </section>
          )}

          <div className="rash-constructor-navigation">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={wizardStep === 1}
              onClick={() => setWizardStep((wizardStep - 1) as WizardStep)}
            >
              Назад
            </button>
            {wizardStep < 6 && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={currentStepBlocked}
                title={
                  currentStepBlocked
                    ? "Исправьте ошибки текущего шага"
                    : undefined
                }
                onClick={() => setWizardStep((wizardStep + 1) as WizardStep)}
              >
                Далее
              </button>
            )}
          </div>

          {backend && adminOk && (
            <div className="rash-constructor-savebar">
              <span>{dirty ? "Изменения не сохранены" : "Все изменения сохранены"}</span>
              <button
                type="button"
                className="btn btn-primary"
                disabled={hasErrors}
                onClick={() => void handleSaveAll()}
              >
                Сохранить
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!dirty}
                onClick={handleDiscard}
              >
                Отменить
              </button>
              {selected && (
                <button type="button" className="btn btn-danger" onClick={() => void handleDelete()}>
                  Удалить
                </button>
              )}
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
            <ColumnKeyInput
              value={formula.totalCol}
              columns={columns}
              allowEmpty
              onChange={(totalCol) => onChange({ ...formula, totalCol })}
            />
          </label>
          <p className="tools-hint">
            Графу можно выбрать из формы или указать свою («Своя графа…»).
          </p>
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
                <ColumnKeyInput
                  value={t.col}
                  columns={columns}
                  allowEmpty
                  onChange={(col) => {
                    const terms = [...formula.terms];
                    terms[idx] = { ...t, col };
                    onChange({ ...formula, terms });
                  }}
                />
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
            <th>Обязательное</th>
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
                  <option value="Текст">Текст</option>
                  <option value="Дата">Дата</option>
                </select>
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={row.required ?? false}
                  onChange={(e) => {
                    const next = [...items];
                    next[idx] = { ...row, required: e.target.checked };
                    onChange(next);
                  }}
                />
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
            {
              kod,
              sort: items.length,
              sumTitle: "",
              fldType: "Сумма",
              required: false,
            },
          ])
        }
      >
        Добавить графу
      </button>
    </>
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
