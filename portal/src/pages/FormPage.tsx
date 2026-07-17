import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../apiClient";
import { loadSchema, listFormCellDefinitions } from "../api";
import { CheckResultsPanel } from "../components/CheckResultsPanel";
import { FormTable } from "../components/FormTable";
import { RashEditorModal } from "../components/RashEditorModal";
import { hasRashRules, isKontrForm } from "../constants";
import { runFormChecks, type CheckRunResult } from "../engine/checkEngine";
import { failedCellsForForm } from "../engine/cellErrors";
import { exportFormToExcel } from "../engine/exportExcel";
import {
  listXlsxSheetNames,
  previewXlsxFormImport,
  type XlsxImportPreview,
} from "../engine/importExcel";
import {
  buildRashCellSlots,
  countRashRulesForForm,
  entriesForRash,
  effectiveRashFormula,
  evaluateTotalFormula,
  getRashData,
  getRashRulesForForm,
  numVal,
  rashColumnsForRule,
  rashGroupKey,
  syncAllRashToRows,
  syncRashToParentRow,
  validateAllRash,
  type RashCellSlot,
  type RashEditorContext,
  type RashValidationIssue,
} from "../engine/rashEngine";
import { loadRowRashIndex, type RowRashIndexData } from "../engine/rowRashIndex";
import { loadRashRefs, type RashRefsData } from "../engine/rashRefs";
import { recalcForm, countRecalcRules } from "../engine/recalcEngine";
import {
  deleteInstance,
  exportInstance,
  importInstanceFile,
  isBackendMode,
  loadAllInstances,
  loadInstance,
  loadKontrAgents,
  loadRashEntries,
  patchInstanceCells,
  saveInstance,
  saveRashEntries,
  setInstanceStatus,
  runInstanceChecks,
} from "../storage";
import type {
  FormInstanceStatus,
  FormMeta,
  FormRashEntry,
  FormSchema,
  KontrAgent,
  OkoFormInstance,
  RashRulesData,
  RowData,
} from "../types";
import { buildInitialRows, alignInstanceRowsToSchema, formatPeriod, formStatusLabel } from "../utils";
import { useAuth } from "../useAuth";
import { formsListBackLabel } from "../formsListLabels";
import { makeRowId } from "@oko/spreadsheet";

export function FormPage() {
  const { instanceId } = useParams<{ instanceId: string }>();
  const navigate = useNavigate();
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [instance, setInstance] = useState<OkoFormInstance | null>(null);
  const [rows, setRows] = useState<RowData[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [meta, setMeta] = useState<FormMeta>({
    organization: "",
    enterpriseCode: "1@1",
    periodStart: "",
    periodEnd: "",
    unit: "тыс.руб.",
  });
  const [signatures, setSignatures] = useState<Record<string, string>>({});
  const [kontrAgents, setKontrAgents] = useState<KontrAgent[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [importingXlsx, setImportingXlsx] = useState(false);
  const [xlsxPreview, setXlsxPreview] = useState<XlsxImportPreview | null>(null);
  const [xlsxSheetNames, setXlsxSheetNames] = useState<string[]>([]);
  const [xlsxBuffer, setXlsxBuffer] = useState<ArrayBuffer | null>(null);
  const [xlsxSheet, setXlsxSheet] = useState("");
  const [cellFormulas, setCellFormulas] = useState<Map<string, string>>(new Map());
  const [recalcing, setRecalcing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckRunResult | null>(null);
  const [rashIssues, setRashIssues] = useState<RashValidationIssue[] | null>(null);
  const [rashRuleCount, setRashRuleCount] = useState<number | null>(null);
  const [rashData, setRashData] = useState<RashRulesData | null>(null);
  const [rowRashIndex, setRowRashIndex] = useState<RowRashIndexData | null>(null);
  const [rashRefs, setRashRefs] = useState<RashRefsData | null>(null);
  const [rashEntries, setRashEntries] = useState<FormRashEntry[]>([]);
  const [rashModal, setRashModal] = useState<RashEditorContext | null>(null);
  const [checkingRash, setCheckingRash] = useState(false);
  const [autoRecalc, setAutoRecalc] = useState(
    () => localStorage.getItem("oko-auto-recalc") !== "0"
  );
  const [recalcRuleCount, setRecalcRuleCount] = useState<number | null>(null);
  const recalcTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const xlsxRef = useRef<HTMLInputElement>(null);

  const kontrMode = schema ? isKontrForm(schema.id) : false;
  const rashMode = hasRashRules(rashRuleCount ?? 0);
  const auth = useAuth();
  const admin = !auth.authRequired || auth.role === "admin";
  const formsBackLabel = formsListBackLabel(auth);
  const instanceStatus: FormInstanceStatus = instance?.status ?? "draft";
  const [periodClosed, setPeriodClosed] = useState(false);
  const isLocked =
    (instanceStatus === "submitted" && !admin) || periodClosed;
  const alignedSchemaKeyRef = useRef<string | null>(null);

  useEffect(() => {
    alignedSchemaKeyRef.current = null;
  }, [instanceId]);

  useEffect(() => {
    if (!instanceId) return;
    setError("");
    setPeriodClosed(false);
    setSchema(null);
    setInstance(null);
    setRows([]);
    loadInstance(instanceId).then((inst) => {
      if (!inst) {
        setError("Форма не найдена. Возможно, она была удалена.");
        return;
      }
      setInstance(inst);
      setDisplayName(inst.displayName);
      setMeta(inst.meta);
      setRows(inst.rows);
      setSignatures(inst.signatures ?? {});

      if (inst.zid != null && inst.eid != null) {
        void import("../packagesApi")
          .then(({ listPeriods }) => listPeriods(inst.zid!))
          .then((periods) => {
            const p = periods.find((x) => x.eid === inst.eid);
            setPeriodClosed(p?.periodStatus === "closed");
          })
          .catch(() => setPeriodClosed(false));
      }

      // Черновик: берём актуальную схему, чтобы новые строки шаблона (после
      // правки в редакторе форм / привязки расшифровки) попали в заполнение.
      // Сданная форма остаётся на pinned version.
      const pinVersion =
        inst.status === "submitted" ? inst.templateSchemaVersion : undefined;
      loadSchema(inst.templateId, pinVersion)
        .then(setSchema)
        .catch((e) => setError(e.message));

      void loadRashEntries(inst.instanceId, inst.templateId)
        .then((loaded) => {
          setRashEntries(loaded);
        })
        .catch(() => setRashEntries(inst.rashEntries ?? []));
    });
  }, [instanceId]);

  /** Новые строки шаблона → в экземпляр (иначе после настройки расшифровки «пропадают»). */
  useEffect(() => {
    if (!schema || !instance || isLocked) return;
    const key = `${instance.instanceId}:${schema.schemaVersion ?? 1}:${schema.rows.length}`;
    if (alignedSchemaKeyRef.current === key) return;

    const { rows: next, added } = alignInstanceRowsToSchema(schema, rows);
    if (added === 0) {
      alignedSchemaKeyRef.current = key;
      return;
    }
    alignedSchemaKeyRef.current = key;

    setRows(next);
    const updated: OkoFormInstance = {
      ...instance,
      rows: next,
      templateSchemaVersion: schema.schemaVersion ?? instance.templateSchemaVersion,
      updatedAt: new Date().toISOString(),
    };
    setInstance(updated);
    void saveInstance(updated)
      .then(() => {
        setStatus(`Добавлены строки из шаблона: ${added}`);
        setTimeout(() => setStatus(""), 4000);
      })
      .catch(() => {
        /* keep UI rows even if save fails */
      });
    // rows намеренно из первого кадра после загрузки схемы
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, instance?.instanceId, isLocked]);

  useEffect(() => {
    if (!schema) return;
    getRashData()
      .then((data) => {
        setRashData(data);
        setRashRuleCount(countRashRulesForForm(schema.id, data.rules));
      })
      .catch(() => {
        setRashData(null);
        setRashRuleCount(null);
      });
    loadRowRashIndex()
      .then(setRowRashIndex)
      .catch(() => setRowRashIndex(null));
    loadRashRefs()
      .then(setRashRefs)
      .catch(() => setRashRefs(null));
  }, [schema]);

  useEffect(() => {
    if (!rashMode || !schema) return;
    loadKontrAgents().then(setKontrAgents).catch(() => setKontrAgents([]));
  }, [rashMode, schema]);

  useEffect(() => {
    if (!schema) return;
    countRecalcRules(schema.id)
      .then(setRecalcRuleCount)
      .catch(() => setRecalcRuleCount(null));
  }, [schema]);

  useEffect(() => {
    if (!schema) {
      setCellFormulas(new Map());
      return;
    }
    void listFormCellDefinitions(schema.id)
      .then((defs) => {
        const map = new Map<string, string>();
        const byRowId = new Map(
          schema.rows.map((r, i) => [
            makeRowId(schema.id, String(r.num ?? ""), i),
            i,
          ] as const)
        );
        for (const d of defs) {
          if (!d.formulaA1) continue;
          const idx = byRowId.get(d.rowId);
          if (idx != null) map.set(`${idx}:${d.columnKey}`, d.formulaA1);
          const num = d.rowId.includes(":")
            ? d.rowId.slice(d.rowId.indexOf(":") + 1)
            : "";
          if (num) map.set(`${num}:${d.columnKey}`, d.formulaA1);
        }
        setCellFormulas(map);
      })
      .catch(() => setCellFormulas(new Map()));
  }, [schema]);

  const rowKinds = useMemo(() => {
    if (!schema) return undefined;
    const byNum = new Map(
      schema.rows.map((r) => [String(r.num ?? "").trim(), r.kind] as const)
    );
    return rows.map((row) => {
      const n = String(row.num ?? "").trim();
      if (n && byNum.has(n)) return byNum.get(n) ?? "data";
      return "data" as const;
    });
  }, [schema, rows]);

  const handleRowsChange = useCallback(
    (next: RowData[]) => {
      setRows(next);
      if (!autoRecalc || !schema || !(recalcRuleCount && recalcRuleCount > 0)) return;
      if (recalcTimer.current) clearTimeout(recalcTimer.current);
      recalcTimer.current = setTimeout(() => {
        void recalcForm(schema, next).then(setRows);
      }, 450);
    },
    [autoRecalc, schema, recalcRuleCount]
  );

  useEffect(() => {
    return () => {
      if (recalcTimer.current) clearTimeout(recalcTimer.current);
    };
  }, []);

  const cellErrors = useMemo(() => {
    if (!schema) return undefined;
    return failedCellsForForm(schema.id, checkResult);
  }, [schema, checkResult]);

  const persist = useCallback(
    async (
      overrides?: Partial<
        Pick<OkoFormInstance, "displayName" | "rows" | "meta" | "signatures" | "rashEntries">
      >
    ) => {
      if (!instance || !schema) return null;
      const nextRows = overrides?.rows ?? rows;
      const nextRash = overrides?.rashEntries ?? rashEntries;
      const updated: OkoFormInstance = {
        ...instance,
        displayName: overrides?.displayName ?? displayName,
        meta: overrides?.meta ?? meta,
        rows: nextRows,
        signatures: overrides?.signatures ?? signatures,
        rashEntries: nextRash,
        updatedAt: new Date().toISOString(),
      };

      const keys = overrides ? Object.keys(overrides) : [];
      // Backend: cells for rows; rash already written via saveRashEntries when present.
      const rowsOnlyPatch =
        isBackendMode() &&
        overrides?.rows != null &&
        keys.every((k) => k === "rows" || k === "rashEntries") &&
        keys.includes("rows");

      if (rowsOnlyPatch) {
        const cells: Array<{
          rowNo: number;
          columnKey: string;
          value?: string | number | null;
        }> = [];
        const prevByNum = new Map(
          instance.rows.map((r, i) => [String(r.num ?? "").trim() || `i${i}`, r])
        );
        nextRows.forEach((neu, i) => {
          const rowNoRaw = String(neu.num ?? "").trim();
          const parsed = parseInt(rowNoRaw, 10);
          const rowNo =
            Number.isFinite(parsed) && parsed !== 0 ? parsed : 900_000_000 + i;
          const old = prevByNum.get(rowNoRaw || `i${i}`) ?? instance.rows[i] ?? {};
          for (const key of Object.keys({ ...old, ...neu })) {
            if (key === "num" || key === "name" || key === "code" || key === "account") {
              continue;
            }
            const ov = old[key];
            const nv = neu[key];
            if (String(ov ?? "") === String(nv ?? "")) continue;
            cells.push({
              rowNo,
              columnKey: key,
              value: nv === undefined ? null : (nv as string | number | null),
            });
          }
        });
        if (cells.length > 0) {
          try {
            const res = await patchInstanceCells(
              instance.instanceId,
              cells,
              instance.revision
            );
            const patched = {
              ...updated,
              revision: res.revision,
            };
            setInstance(patched);
            return patched;
          } catch {
            /* fall through to full save */
          }
        }
      }

      await saveInstance(updated);
      setInstance(updated);
      return updated;
    },
    [instance, schema, displayName, meta, rows, signatures, rashEntries]
  );

  useEffect(() => {
    if (!schema || !rashData || kontrMode || rashEntries.length === 0 || isLocked) return;
    setRows((prev) => syncAllRashToRows(schema.id, prev, rashEntries, rashData.rules));
  }, [schema?.id, rashData, kontrMode, rashEntries, isLocked]);

  const kontrRefA1Name = useMemo(() => {
    if (!schema || !rashData) return null;
    const rules = getRashRulesForForm(rashData.rules, schema.id);
    return rules.find((r) => r.refA1Name)?.refA1Name ?? null;
  }, [schema, rashData]);

  const rashSlots = useMemo(() => {
    if (!schema || !rashData || kontrMode) return [];
    return buildRashCellSlots(
      schema.id,
      rows,
      schema.columns,
      rashData.rules,
      rashData.thresholds,
      rowRashIndex ?? undefined
    );
  }, [schema, rows, rashData, rowRashIndex, kontrMode]);

  const rashEntryCounts = useMemo(() => {
    const map = new Map<string, number>();
    if (!schema) return map;
    for (const e of rashEntries) {
      if (e.formId !== schema.id) continue;
      const key = rashGroupKey(e.parentRowNo, e.rashKod);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [rashEntries, schema]);

  const rashReadonlyCells = useMemo(() => {
    const set = new Set<string>();
    if (kontrMode) return set;
    for (const slot of rashSlots) {
      const cols = effectiveRashFormula(slot.rule)
        ? rashColumnsForRule(slot.rule)
        : [slot.displayColumnKey ?? slot.columnKey];
      for (const col of cols) {
        set.add(`${slot.rowNum}:${col}`);
      }
    }
    return set;
  }, [rashSlots, kontrMode]);

  const openRashModal = useCallback(
    (slot: RashCellSlot, rowIndex: number) => {
      if (!schema || isLocked) return;
      const row = rows[rowIndex];
      const placementColumns = [
        ...new Set(
          rashSlots
            .filter(
              (s) =>
                s.rowNum === slot.rowNum &&
                s.rashKod === slot.rashKod
            )
            .map((s) => s.displayColumnKey ?? s.columnKey)
        ),
      ];
      setRashModal({
        formId: schema.id,
        parentRowNo: parseInt(slot.rowNum, 10),
        parentRowIndex: rowIndex,
        columnKey: slot.displayColumnKey ?? slot.columnKey,
        rashKod: slot.rashKod,
        rule: slot.rule,
        parentLabel: String(row.name ?? slot.rowNum),
        parentValue:
          slot.pattern === "total" && effectiveRashFormula(slot.rule)
            ? evaluateTotalFormula(effectiveRashFormula(slot.rule)!, row)
            : numVal(row[slot.displayColumnKey ?? slot.columnKey]),
        placementColumns,
      });
    },
    [schema, rows, isLocked, rashSlots]
  );

  const handleRashSave = useCallback(
    async (newLines: FormRashEntry[]) => {
      if (!rashModal || !schema || !instance) return;
      const { formId, parentRowNo, rashKod, parentRowIndex } = rashModal;
      // Replace whole t_ras group for row+kod (ignore legacy columnKey splits).
      const rest = rashEntries.filter(
        (e) =>
          !(
            e.formId === formId &&
            e.parentRowNo === parentRowNo &&
            e.rashKod === rashKod
          )
      );
      const tagged = newLines.map((e, i) => ({
        ...e,
        formId,
        parentRowNo,
        rashKod,
        columnKey: null,
        lineNo: i,
      }));
      const nextEntries = [...rest, ...tagged];
      setRashEntries(nextEntries);
      await saveRashEntries(instance.instanceId, schema.id, nextEntries);

      let nextRows = rows;
      if (!kontrMode) {
        nextRows = syncRashToParentRow(
          rows,
          parentRowIndex,
          nextEntries,
          formId,
          rashKod,
          rashModal.rule
        );
        if (autoRecalc && recalcRuleCount && recalcRuleCount > 0) {
          nextRows = await recalcForm(schema, nextRows);
        }
        setRows(nextRows);
        await persist({ rows: nextRows, rashEntries: nextEntries });
      } else {
        await persist({ rashEntries: nextEntries });
      }
      setRashModal(null);
      setStatus("Расшифровка сохранена");
      setTimeout(() => setStatus(""), 3000);
    },
    [
      rashModal,
      schema,
      instance,
      rashEntries,
      rows,
      kontrMode,
      persist,
      autoRecalc,
      recalcRuleCount,
    ]
  );

  const rashModalEntries = useMemo(() => {
    if (!rashModal || !schema) return [];
    return entriesForRash(
      rashEntries,
      schema.id,
      rashModal.parentRowNo,
      rashModal.rashKod
    );
  }, [rashEntries, rashModal, schema]);

  const handleSave = useCallback(async () => {
    if (!instance || isLocked) return;
    await persist();
    setStatus("Сохранено " + new Date().toLocaleTimeString("ru-RU"));
    setTimeout(() => setStatus(""), 3000);
  }, [instance, isLocked, persist]);

  const handleSubmitForm = async () => {
    if (!instance || instanceStatus === "submitted") return;
    if (rashMode && rashData && schema) {
      const issues = validateAllRash(
        schema.id,
        rows,
        schema.columns,
        rashEntries,
        rashData,
        rowRashIndex ?? undefined,
        kontrAgents
      );
      const errors = issues.filter((i) => i.severity === "error");
      if (errors.length > 0) {
        setRashIssues(issues);
        setStatus(
          `Сдача заблокирована: ${errors.length} ошибок расшифровки. Исправьте и повторите.`
        );
        return;
      }
    }
    if (!confirm("Сдать форму? После сдачи редактирование будет недоступно (только администратор сможет вернуть в черновик).")) {
      return;
    }
    await persist();
    try {
      const updated = await setInstanceStatus(instance.instanceId, "submitted");
      setInstance(updated);
      setStatus("Форма сдана");
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        const body = e.body as {
          error?: string;
          result?: CheckRunResult;
          message?: { error?: string; result?: CheckRunResult };
        };
        const result = body?.result ?? body?.message?.result;
        if (result) setCheckResult(result);
        setStatus(e.message);
        return;
      }
      setStatus(e instanceof Error ? e.message : "Не удалось сдать форму");
    }
  };

  const handleReopenForm = async () => {
    if (!instance || !admin) return;
    if (!confirm("Вернуть форму в черновик?")) return;
    const updated = await setInstanceStatus(instance.instanceId, "draft");
    setInstance(updated);
    setStatus("Форма возвращена в черновик");
  };

  const handleReset = async () => {
    if (!schema || !instance) return;
    if (!confirm("Сбросить все введённые данные к шаблону?")) return;
    const fresh = buildInitialRows(schema);
    const sigs: Record<string, string> = {};
    for (const name of schema.signatures) sigs[name] = "";
    setRows(fresh);
    setSignatures(sigs);
    setRashEntries([]);
    if (instance) {
      await saveRashEntries(instance.instanceId, schema.id, []);
    }
    await persist({ rows: fresh, signatures: sigs });
    setCheckResult(null);
    setStatus("Данные сброшены к шаблону");
  };

  const handleDelete = async () => {
    if (!instance) return;
    if (!confirm(`Удалить форму «${instance.displayName}»?`)) return;
    await deleteInstance(instance.instanceId);
    navigate("/my");
  };

  const handleExport = () => {
    if (!instance) return;
    exportInstance({
      ...instance,
      displayName,
      meta,
      rows,
      signatures,
    });
  };

  const handleExportPdf = async () => {
    if (!schema || !instance) return;
    setExportingPdf(true);
    try {
      await persist();
      const { exportFormToPdf } = await import("../exportPdf");
      exportFormToPdf({
        schema,
        displayName,
        meta,
        rows,
        signatures,
      });
      setStatus("PDF сохранён");
      setTimeout(() => setStatus(""), 3000);
    } catch {
      setError("Не удалось сформировать PDF");
    } finally {
      setExportingPdf(false);
    }
  };

  const handleRecalc = async () => {
    if (!schema) return;
    setRecalcing(true);
    try {
      const next = await recalcForm(schema, rows);
      setRows(next);
      await persist({ rows: next });
      setStatus("Строки пересчитаны");
      setTimeout(() => setStatus(""), 3000);
    } catch {
      setError("Ошибка пересчёта");
    } finally {
      setRecalcing(false);
    }
  };

  const handleExportExcel = async () => {
    if (!schema || !instance) return;
    setExportingExcel(true);
    try {
      await persist();
      await exportFormToExcel({
        schema,
        displayName,
        meta,
        rows,
      });
      setStatus("Файл Excel сохранён");
      setTimeout(() => setStatus(""), 3000);
    } catch {
      setError("Не удалось сформировать Excel");
    } finally {
      setExportingExcel(false);
    }
  };

  const handleCheckRash = async () => {
    if (!schema || !rashMode || !rashData) return;
    setCheckingRash(true);
    setRashIssues(null);
    try {
      const issues = validateAllRash(
        schema.id,
        rows,
        schema.columns,
        rashEntries,
        rashData,
        rowRashIndex ?? undefined,
        kontrAgents
      );
      setRashIssues(issues);
      setStatus(
        issues.length === 0
          ? "Расшифровки: замечаний нет"
          : `Расшифровки: ${issues.filter((i) => i.severity === "error").length} ошибок, ${issues.filter((i) => i.severity === "warning").length} предупреждений`
      );
      setTimeout(() => setStatus(""), 5000);
    } catch {
      setError("Не удалось проверить расшифровки");
    } finally {
      setCheckingRash(false);
    }
  };

  const handleCheck = async () => {
    if (!schema || !instance) return;
    setChecking(true);
    setCheckResult(null);
    try {
      await persist();
      const serverResult = await runInstanceChecks(instance.instanceId, "period");
      if (serverResult) {
        setCheckResult(serverResult);
        setStatus(
          serverResult.failed === 0 && serverResult.skipped === 0
            ? "Проверка пройдена (сервер)"
            : `Ошибок увязок: ${serverResult.failed}` +
              (serverResult.skipped ? `, не разобрано: ${serverResult.skipped}` : "")
        );
      } else {
        const all = await loadAllInstances();
        const result = await runFormChecks(schema.id, all);
        setCheckResult(result);
        setStatus(
          result.failed === 0
            ? "Проверка пройдена"
            : `Ошибок увязок: ${result.failed}`
        );
      }
      setTimeout(() => setStatus(""), 5000);
    } catch {
      setError("Не удалось выполнить проверку");
    } finally {
      setChecking(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !instance) return;
    try {
      const imported = await importInstanceFile(file);
      navigate(`/my/${imported.instanceId}`);
    } catch {
      setError("Ошибка импорта файла");
    }
    e.target.value = "";
  };

  const handleXlsxPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !schema) return;
    setImportingXlsx(true);
    setError("");
    try {
      const buf = await file.arrayBuffer();
      const names = await listXlsxSheetNames(buf);
      setXlsxBuffer(buf);
      setXlsxSheetNames(names);
      const sheet = names[0] ?? "";
      setXlsxSheet(sheet);
      const preview = await previewXlsxFormImport({
        buffer: buf,
        schema,
        currentRows: rows,
        sheetName: sheet || undefined,
      });
      setXlsxPreview(preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка чтения Excel");
      setXlsxPreview(null);
      setXlsxBuffer(null);
    } finally {
      setImportingXlsx(false);
    }
  };

  const refreshXlsxPreview = async (sheetName: string) => {
    if (!xlsxBuffer || !schema) return;
    setXlsxSheet(sheetName);
    setImportingXlsx(true);
    try {
      const preview = await previewXlsxFormImport({
        buffer: xlsxBuffer,
        schema,
        currentRows: rows,
        sheetName: sheetName || undefined,
      });
      setXlsxPreview(preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка предпросмотра Excel");
    } finally {
      setImportingXlsx(false);
    }
  };

  const applyXlsxImport = async () => {
    if (!xlsxPreview || isLocked) return;
    setRows(xlsxPreview.proposedRows);
    await persist({ rows: xlsxPreview.proposedRows });
    setStatus(
      `Импорт Excel: лист «${xlsxPreview.sheetName}», строк ${xlsxPreview.matchedRows}, изменений ${xlsxPreview.diffs.length}`
    );
    setXlsxPreview(null);
    setXlsxBuffer(null);
    setTimeout(() => setStatus(""), 5000);
  };

  if (error) {
    return (
      <div className="form-page">
        <div className="error-box">{error}</div>
        <Link to="/my" className="btn btn-primary" style={{ marginTop: "1rem" }}>
          {formsBackLabel}
        </Link>
      </div>
    );
  }

  if (!schema || !instance) {
    return <div className="loading">Загрузка формы…</div>;
  }

  const pdfUrl = schema.pdfFile ? `/pdf/${schema.pdfFile}` : null;

  return (
    <div className="form-page">
      <div className="form-toolbar">
        <div className="toolbar-breadcrumb">
          <Link to="/my" className="back-link">
            {formsBackLabel}
          </Link>
          <Link to="/catalog" className="back-link muted">
            Каталог
          </Link>
        </div>
        <div className="form-title-block form-title-block-wide">
          <label className="display-name-label">
            Название сохранённой формы
            <input
              className="display-name-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onBlur={() => void persist({ displayName })}
            />
          </label>
          <div className="form-subtitle">
            <span className="form-code">{schema.id}</span>
            <span>{schema.title}</span>
            <span className={`status-badge ${instanceStatus}`}>
              {formStatusLabel(instanceStatus)}
            </span>
          </div>
        </div>
        <div className="toolbar-actions">
          {pdfUrl && (
            <a href={pdfUrl} target="_blank" rel="noreferrer" className="btn btn-outline">
              Образец PDF
            </a>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fileRef.current?.click()}
          >
            Импорт
          </button>
          <input ref={fileRef} type="file" accept=".json" hidden onChange={handleImport} />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={isLocked || importingXlsx}
            onClick={() => xlsxRef.current?.click()}
            title="Импорт значений из .xlsx (предпросмотр)"
          >
            {importingXlsx ? "Excel…" : "Импорт Excel"}
          </button>
          <input
            ref={xlsxRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            hidden
            onChange={(e) => void handleXlsxPick(e)}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleExportPdf}
            disabled={exportingPdf}
          >
            {exportingPdf ? "PDF…" : "Сохранить PDF"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleRecalc}
            disabled={recalcing}
            title={
              recalcRuleCount != null
                ? `Правил пересчёта: ${recalcRuleCount}`
                : undefined
            }
          >
            {recalcing ? "…" : "Пересчёт"}
          </button>
          {(recalcRuleCount ?? 0) > 0 && (
            <label className="auto-recalc-toggle" title="Пересчёт итоговых строк и граф">
              <input
                type="checkbox"
                checked={autoRecalc}
                onChange={(e) => {
                  const on = e.target.checked;
                  setAutoRecalc(on);
                  localStorage.setItem("oko-auto-recalc", on ? "1" : "0");
                }}
              />
              Автопересчёт
            </label>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleExportExcel}
            disabled={exportingExcel}
          >
            {exportingExcel ? "Выгрузка…" : "Выгрузить в Excel"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleCheck} disabled={checking}>
            {checking ? "Проверка…" : "Проверить форму"}
          </button>
          {rashMode && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleCheckRash()}
              disabled={checkingRash}
              title={
                rashRuleCount != null
                  ? `Правил расшифровки для ${schema.id}: ${rashRuleCount}`
                  : undefined
              }
            >
              {checkingRash ? "Расшифровка…" : "Проверить расшифровки"}
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={handleExport}>
            Экспорт формы
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void handleReset()}>
            Сбросить данные
          </button>
          <button type="button" className="btn btn-danger-outline" onClick={() => void handleDelete()}>
            Удалить
          </button>
          {instanceStatus === "draft" && !isLocked && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleSubmitForm()}
            >
              Сдать форму
            </button>
          )}
          {instanceStatus === "submitted" && admin && !periodClosed && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleReopenForm()}
            >
              Вернуть в черновик
            </button>
          )}
          {!isLocked && (
            <button type="button" className="btn btn-primary" onClick={() => void handleSave()}>
              Сохранить
            </button>
          )}
        </div>
      </div>
      {status && <div className="status-bar">{status}</div>}
      {isLocked && (
        <div className="status-bar status-locked">
          {periodClosed
            ? "Период закрыт — форма только для просмотра."
            : "Форма сдана и доступна только для просмотра. Для правок обратитесь к администратору."}
        </div>
      )}
      {periodClosed && instanceStatus === "submitted" && admin && (
        <div className="tools-hint">
          Период закрыт: даже admin не может править без переоткрытия периода.
        </div>
      )}
      <CheckResultsPanel result={checkResult} loading={checking} />

      {rashMode && rashRuleCount != null && rashRuleCount > 0 && (
        <p className="tools-hint" style={{ margin: "0.5rem 0" }}>
          {kontrMode ? (
            <>
              Форма с расшифровкой контрагентов в строках
            </>
          ) : (
            <>
              Суммы на форме формируются из расшифровки. Ввод в графах B–M вручную
              недоступен — нажмите кнопку <strong>«…»</strong> справа в ячейке, чтобы
              открыть окно контрагентов
            </>
          )}
          : правил расшифровки — <strong>{rashRuleCount}</strong>. Пороги: 1 тыс. /
          5 млн / 50 млн руб. (
          <Link to="/admin/rash">настройки</Link>).
        </p>
      )}

      {rashIssues && rashIssues.length > 0 && (
        <section className="rash-results" style={{ marginBottom: "1rem" }}>
          <div className="rash-summary">
            <span className="rash-stat fail">
              Ошибок: {rashIssues.filter((i) => i.severity === "error").length}
            </span>
            <span className="rash-stat warn">
              Предупреждений: {rashIssues.filter((i) => i.severity === "warning").length}
            </span>
          </div>
          <ul className="rash-issues-list">
            {rashIssues.map((issue, idx) => (
              <li key={idx} className={issue.severity === "error" ? "rash-error" : "rash-warn"}>
                Строка {issue.rowIndex + 1} ({issue.rowLabel}), гр. {issue.column}: {issue.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="form-meta-panel">
        <div className="meta-grid">
          <label>
            Код предприятия
            <input
              value={meta.enterpriseCode}
              disabled={isLocked}
              onChange={(e) => setMeta({ ...meta, enterpriseCode: e.target.value })}
            />
          </label>
          <label className="meta-wide">
            Организация
            <input
              value={meta.organization}
              disabled={isLocked}
              onChange={(e) => setMeta({ ...meta, organization: e.target.value })}
              placeholder="Наименование организации"
            />
          </label>
          <label>
            Начало периода
            <input
              type="date"
              value={meta.periodStart}
              disabled={isLocked}
              onChange={(e) => setMeta({ ...meta, periodStart: e.target.value })}
            />
          </label>
          <label>
            Конец периода
            <input
              type="date"
              value={meta.periodEnd}
              disabled={isLocked}
              onChange={(e) => setMeta({ ...meta, periodEnd: e.target.value })}
            />
          </label>
          <label>
            Ед. изм.
            <input
              value={meta.unit}
              disabled={isLocked}
              onChange={(e) => setMeta({ ...meta, unit: e.target.value })}
            />
          </label>
        </div>
        <p className="period-hint">
          Отчётный период: {formatPeriod(meta.periodStart, meta.periodEnd)} · {meta.unit}
        </p>
      </section>

      <FormTable
        columns={schema.columns}
        rows={rows}
        formId={schema.id}
        onChange={handleRowsChange}
        allowAddRows={schema.allowAddRows || kontrMode}
        rowKinds={rowKinds}
        cellFormulas={cellFormulas}
        kontrMode={kontrMode}
        kontrAgents={kontrAgents}
        kontrRefA1Name={kontrRefA1Name}
        rashThresholds={rashData?.thresholds}
        cellErrors={cellErrors}
        readOnly={isLocked}
        rashSlots={rashSlots}
        rashEntryCounts={rashEntryCounts}
        rashReadonlyCells={rashReadonlyCells}
        onRashOpen={rashMode && !isLocked ? openRashModal : undefined}
      />

      {xlsxPreview && (
        <div className="rash-modal-backdrop" onClick={() => setXlsxPreview(null)}>
          <div
            className="rash-modal xlsx-import-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="rash-modal-header">
              <h2>Импорт из Excel</h2>
              <button type="button" className="btn-icon" onClick={() => setXlsxPreview(null)}>
                ×
              </button>
            </header>
            <p className="tools-hint">
              Лист: <strong>{xlsxPreview.sheetName}</strong> · совпало строк:{" "}
              {xlsxPreview.matchedRows} · отличий: {xlsxPreview.diffs.length}
              . Макросы и внешние ссылки не выполняются.
            </p>
            {xlsxSheetNames.length > 1 && (
              <label>
                Лист
                <select
                  value={xlsxSheet}
                  onChange={(e) => void refreshXlsxPreview(e.target.value)}
                >
                  {xlsxSheetNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {xlsxPreview.warnings.length > 0 && (
              <ul className="rash-validation">
                {xlsxPreview.warnings.slice(0, 8).map((w, i) => (
                  <li key={i} className="warn">
                    {w}
                  </li>
                ))}
              </ul>
            )}
            <table className="checks-table">
              <thead>
                <tr>
                  <th>Стр.</th>
                  <th>Графа</th>
                  <th>Было</th>
                  <th>Excel</th>
                  <th>Чт.</th>
                </tr>
              </thead>
              <tbody>
                {xlsxPreview.diffs.slice(0, 60).map((d, i) => (
                  <tr key={i}>
                    <td>{d.rowNo}</td>
                    <td>{d.columnKey}</td>
                    <td>{String(d.formValue)}</td>
                    <td>{String(d.excelValue)}</td>
                    <td>{d.readonly ? "да" : ""}</td>
                  </tr>
                ))}
                {xlsxPreview.diffs.length === 0 && (
                  <tr>
                    <td colSpan={5}>Отличий нет</td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="toolbar-actions" style={{ marginTop: "1rem" }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={isLocked || xlsxPreview.diffs.every((d) => d.readonly)}
                onClick={() => void applyXlsxImport()}
              >
                Применить
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setXlsxPreview(null);
                  setXlsxBuffer(null);
                }}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {rashData && (
        <RashEditorModal
          open={!!rashModal}
          onClose={() => setRashModal(null)}
          onSave={(entries) => void handleRashSave(entries)}
          context={
            rashModal
              ? {
                  formId: rashModal.formId,
                  parentRowNo: rashModal.parentRowNo,
                  columnKey: rashModal.columnKey,
                  rashKod: rashModal.rashKod,
                  rule: rashModal.rule,
                  parentLabel: rashModal.parentLabel,
                  parentValue: rashModal.parentValue,
                  placementColumns: rashModal.placementColumns,
                }
              : null
          }
          entries={rashModalEntries}
          formColumns={schema.columns}
          addsum={rashData.addsum}
          kontrAgents={kontrAgents}
          rashRefs={rashRefs}
          readOnly={isLocked}
        />
      )}

      {schema.signatures.length > 0 && (
        <section className="signatures">
          <h3>Подписи</h3>
          <div className="sig-grid">
            {schema.signatures.map((name, sigIdx) => (
              <label key={`${sigIdx}:${name}`}>
                {name}
                <input
                  value={signatures[name] ?? ""}
                  onChange={(e) =>
                    setSignatures((s) => ({ ...s, [name]: e.target.value }))
                  }
                  placeholder="ФИО"
                />
              </label>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
