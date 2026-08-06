import { useEffect, useMemo, useState } from "react";
import { loadCatalog } from "../api";
import {
  constructPackages,
  previewPackageConstruct,
} from "../packagesApi";
import { orgOptionLabel, packageKindLabel } from "../uiLabels";
import type {
  FormCatalog,
  Organization,
  PackageConstructInput,
  PackageConstructPreview,
  PackageConstructResult,
} from "../types";
import {
  currentReportingQuarter,
  formatPeriod,
  quarterDateRange,
  quarterPeriodName,
} from "../utils";

type ConstructMode = "single" | "bulk";
type FormsMode = "all" | "selected";
type PackageKind = "OKO" | "BALANCE";

type Props = {
  orgs: Organization[];
  admin: boolean;
  canMutate: boolean;
  defaultZid?: number | "";
  onCreated: (zid: number, eid: number, packageKind: PackageKind) => void | Promise<void>;
};

export function PackageConstructor({
  orgs,
  admin,
  canMutate,
  defaultZid = "",
  onCreated,
}: Props) {
  const initialQy = currentReportingQuarter();
  const [mode, setMode] = useState<ConstructMode>("single");
  const [singleZid, setSingleZid] = useState<number | "">(
    typeof defaultZid === "number" ? defaultZid : orgs[0]?.zid ?? ""
  );
  const [selectedZids, setSelectedZids] = useState<number[]>(
    typeof defaultZid === "number" ? [defaultZid] : []
  );
  const [orgSearch, setOrgSearch] = useState("");
  const [quarter, setQuarter] = useState(initialQy.quarter);
  const [year, setYear] = useState(initialQy.year);
  const [packageKind, setPackageKind] = useState<PackageKind>("OKO");
  const [reuseExisting, setReuseExisting] = useState(true);
  const [createInstances, setCreateInstances] = useState(true);
  const [formsMode, setFormsMode] = useState<FormsMode>("all");
  const [selectedFormIds, setSelectedFormIds] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<FormCatalog | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [formSearch, setFormSearch] = useState("");
  const [preview, setPreview] = useState<PackageConstructPreview | null>(null);
  const [result, setResult] = useState<PackageConstructResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadCatalog()
      .then((c) => {
        if (!cancelled) setCatalog(c);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof defaultZid === "number") {
      setSingleZid(defaultZid);
      setSelectedZids((prev) => (prev.includes(defaultZid) ? prev : [defaultZid]));
    }
  }, [defaultZid]);

  const filteredOrgs = useMemo(() => {
    const q = orgSearch.trim().toLowerCase();
    if (!q) return orgs;
    return orgs.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        (o.code ?? "").toLowerCase().includes(q) ||
        String(o.zid).includes(q)
    );
  }, [orgs, orgSearch]);

  const catalogForms = useMemo(
    () => (catalog?.forms ?? []).filter((f) => !f.archived),
    [catalog]
  );

  const categories = useMemo(() => {
    const set = new Set(catalogForms.map((f) => f.category).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [catalogForms]);

  const visibleForms = useMemo(() => {
    const q = formSearch.trim().toLowerCase();
    return catalogForms.filter((f) => {
      if (categoryFilter && f.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        f.id.toLowerCase().includes(q) ||
        f.title.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q)
      );
    });
  }, [catalogForms, categoryFilter, formSearch]);

  const periodMeta = useMemo(() => {
    const name = quarterPeriodName(quarter, year);
    const range = quarterDateRange(quarter, year);
    return { name, ...range };
  }, [quarter, year]);

  const targetZids = useMemo(() => {
    if (mode === "single") {
      return typeof singleZid === "number" ? [singleZid] : [];
    }
    return selectedZids;
  }, [mode, singleZid, selectedZids]);

  const buildInput = (): PackageConstructInput => ({
    mode,
    targets: targetZids.map((zid) => ({ zid })),
    period: {
      name: periodMeta.name,
      periodStart: periodMeta.periodStart,
      periodEnd: periodMeta.periodEnd,
      quarter,
      year,
      packageKind,
      reuseExisting,
    },
    forms: {
      mode: formsMode,
      formIds: formsMode === "selected" ? selectedFormIds : undefined,
    },
    options: {
      createInstances,
      continueOnError: true,
    },
  });

  const validate = (): string | null => {
    if (!canMutate) return "Нет прав на создание";
    if (!targetZids.length) return "Выберите организацию";
    if (quarter < 1 || quarter > 4) return "Выберите квартал";
    if (!Number.isFinite(year) || year < 2000) return "Укажите год";
    if (formsMode === "selected" && selectedFormIds.length === 0) {
      return "Выберите хотя бы одну форму";
    }
    if (mode === "bulk" && !admin) return "Массовое создание доступно только администратору";
    return null;
  };

  const handlePreview = async () => {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setPreview(await previewPackageConstruct(buildInput()));
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : "Ошибка предпросмотра");
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    if (mode === "bulk" && !preview) {
      setError("Сначала выполните предпросмотр");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await constructPackages(buildInput());
      setResult(res);
      setPreview(res);
      const firstOk = res.rows.find((r) => r.status === "created" && r.eid != null);
      if (firstOk?.eid != null) {
        await onCreated(firstOk.zid, firstOk.eid, packageKind);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка создания");
    } finally {
      setBusy(false);
    }
  };

  const toggleZid = (zid: number) => {
    setSelectedZids((prev) =>
      prev.includes(zid) ? prev.filter((x) => x !== zid) : [...prev, zid]
    );
    setPreview(null);
    setResult(null);
  };

  const selectChildrenOf = (parentZid: number) => {
    const kids = orgs.filter((o) => o.parentZid === parentZid).map((o) => o.zid);
    setSelectedZids(kids);
    setPreview(null);
    setResult(null);
  };

  const toggleForm = (formId: string) => {
    setSelectedFormIds((prev) =>
      prev.includes(formId) ? prev.filter((x) => x !== formId) : [...prev, formId]
    );
    setPreview(null);
    setResult(null);
  };

  const selectCategoryForms = (category: string) => {
    const ids = catalogForms.filter((f) => f.category === category).map((f) => f.id);
    setSelectedFormIds((prev) => [...new Set([...prev, ...ids])]);
    setPreview(null);
    setResult(null);
  };

  const displayRows = result?.rows ?? preview?.rows ?? [];
  const summary = result?.summary ?? preview?.summary;

  if (!canMutate) {
    return (
      <section className="tools-section">
        <h2>Создание комплектов</h2>
        <p className="tools-hint">Недостаточно прав для создания комплектов.</p>
      </section>
    );
  }

  return (
    <section className="tools-section package-constructor">
      <h2>Создание комплектов</h2>
      <p className="tools-hint">
        Один или несколько комплектов: период, состав форм, предпросмотр и создание.
      </p>
      {error && <p className="error">{error}</p>}

      <div className="tools-tabs" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className={mode === "single" ? "active" : undefined}
          onClick={() => {
            setMode("single");
            setPreview(null);
            setResult(null);
          }}
        >
          Один комплект
        </button>
        {admin && (
          <button
            type="button"
            className={mode === "bulk" ? "active" : undefined}
            onClick={() => {
              setMode("bulk");
              setPreview(null);
              setResult(null);
            }}
          >
            Несколько организаций
          </button>
        )}
      </div>

      <h3>1. Организации</h3>
      {mode === "single" ? (
        <div className="tools-grid" style={{ marginBottom: 12 }}>
          <label>
            Организация
            <select
              value={singleZid === "" ? "" : String(singleZid)}
              onChange={(e) => {
                setSingleZid(e.target.value === "" ? "" : Number(e.target.value));
                setPreview(null);
                setResult(null);
              }}
            >
              <option value="">— выберите —</option>
              {orgs.map((o) => (
                <option key={o.zid} value={o.zid}>
                  {orgOptionLabel(o)}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <div style={{ marginBottom: 12 }}>
          <div className="toolbar-actions" style={{ marginBottom: 8 }}>
            <input
              type="search"
              className="search-input"
              placeholder="Поиск организаций…"
              value={orgSearch}
              onChange={(e) => setOrgSearch(e.target.value)}
              style={{ minWidth: 220 }}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setSelectedZids(filteredOrgs.map((o) => o.zid));
                setPreview(null);
                setResult(null);
              }}
            >
              Все
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={typeof singleZid !== "number" && typeof defaultZid !== "number"}
              onClick={() => {
                const parent =
                  typeof defaultZid === "number"
                    ? defaultZid
                    : typeof singleZid === "number"
                      ? singleZid
                      : orgs[0]?.zid;
                if (parent != null) selectChildrenOf(parent);
              }}
            >
              Дочерние выбранной
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setSelectedZids([]);
                setPreview(null);
                setResult(null);
              }}
            >
              Снять все
            </button>
          </div>
          <p className="tools-hint">Выбрано: {selectedZids.length}</p>
          <div className="aggr-list package-constructor-org-list">
            {filteredOrgs.map((o) => (
              <label key={o.zid} className="package-constructor-check-row">
                <input
                  type="checkbox"
                  checked={selectedZids.includes(o.zid)}
                  onChange={() => toggleZid(o.zid)}
                />
                <span>
                  {orgOptionLabel(o)}
                  {o.parentZid != null ? (
                    <span className="table-sub"> · дочерняя</span>
                  ) : null}
                </span>
              </label>
            ))}
            {!filteredOrgs.length && <p className="tools-hint">Нет организаций</p>}
          </div>
        </div>
      )}

      <h3>2. Отчётный период</h3>
      <div className="tools-grid" style={{ marginBottom: 8 }}>
        <label>
          Квартал
          <select
            value={quarter}
            onChange={(e) => {
              setQuarter(Number(e.target.value));
              setPreview(null);
              setResult(null);
            }}
          >
            <option value={1}>1 квартал</option>
            <option value={2}>2 квартал</option>
            <option value={3}>3 квартал</option>
            <option value={4}>4 квартал</option>
          </select>
        </label>
        <label>
          Год
          <input
            type="number"
            min={2000}
            max={2100}
            value={year}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isFinite(next)) {
                setYear(next);
                setPreview(null);
                setResult(null);
              }
            }}
          />
        </label>
        <label>
          Тип комплекта
          <select
            value={packageKind}
            onChange={(e) => {
              setPackageKind(e.target.value as PackageKind);
              setPreview(null);
              setResult(null);
            }}
          >
            <option value="OKO">ОКО</option>
            <option value="BALANCE">Баланс</option>
          </select>
        </label>
      </div>
      <p className="tools-hint" style={{ marginBottom: 12 }}>
        Период: <strong>{periodMeta.name}</strong>
        {" · "}
        {formatPeriod(periodMeta.periodStart, periodMeta.periodEnd)}
        {" · "}
        {packageKindLabel(packageKind)}
      </p>
      <div className="package-workspace-checkboxes" style={{ marginBottom: 12 }}>
        <label>
          <input
            type="checkbox"
            checked={reuseExisting}
            onChange={(e) => {
              setReuseExisting(e.target.checked);
              setPreview(null);
              setResult(null);
            }}
          />{" "}
          Если период уже есть — дозавести недостающие формы
        </label>
        <label>
          <input
            type="checkbox"
            checked={createInstances}
            onChange={(e) => {
              setCreateInstances(e.target.checked);
              setPreview(null);
              setResult(null);
            }}
          />{" "}
          Сразу завести пустые формы
        </label>
      </div>

      <h3>3. Состав форм</h3>
      <div className="tools-tabs" style={{ marginBottom: 8 }}>
        <button
          type="button"
          className={formsMode === "all" ? "active" : undefined}
          onClick={() => {
            setFormsMode("all");
            setPreview(null);
            setResult(null);
          }}
        >
          Полный комплект ({catalogForms.length})
        </button>
        <button
          type="button"
          className={formsMode === "selected" ? "active" : undefined}
          onClick={() => {
            setFormsMode("selected");
            setPreview(null);
            setResult(null);
          }}
        >
          Выбранные формы
        </button>
      </div>
      {formsMode === "selected" && (
        <>
          <div className="tools-grid" style={{ marginBottom: 8 }}>
            <label>
              Категория
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="">Все</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {catalog?.categories?.[c] ?? c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Поиск формы
              <input
                type="search"
                value={formSearch}
                onChange={(e) => setFormSearch(e.target.value)}
                placeholder="Код или название…"
              />
            </label>
          </div>
          <div className="toolbar-actions" style={{ marginBottom: 8 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setSelectedFormIds(visibleForms.map((f) => f.id));
                setPreview(null);
                setResult(null);
              }}
            >
              Выбрать видимые
            </button>
            {categoryFilter && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => selectCategoryForms(categoryFilter)}
              >
                Всю категорию
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setSelectedFormIds([]);
                setPreview(null);
                setResult(null);
              }}
            >
              Снять выбор
            </button>
            <span className="tools-hint">Выбрано: {selectedFormIds.length}</span>
          </div>
          <div className="aggr-list package-constructor-form-list">
            {visibleForms.map((f) => (
              <label key={f.id} className="package-constructor-check-row">
                <input
                  type="checkbox"
                  checked={selectedFormIds.includes(f.id)}
                  onChange={() => toggleForm(f.id)}
                />
                <span>
                  <strong>{f.id}</strong> — {f.title}
                  <span className="table-sub"> · {f.category}</span>
                </span>
              </label>
            ))}
          </div>
        </>
      )}

      <div className="toolbar-actions" style={{ marginTop: 16, marginBottom: 12 }}>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => void handlePreview()}
        >
          {busy ? "…" : "Предпросмотр"}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || (mode === "bulk" && !preview)}
          onClick={() => void handleCreate()}
        >
          {busy
            ? "Создание…"
            : `Создать${targetZids.length ? ` (${targetZids.length})` : ""}`}
        </button>
      </div>

      {summary && (
        <p className="tools-hint">
          Целей: <strong>{summary.targets}</strong>
          {" · периодов к созданию/создано: "}
          <strong>{summary.periodsCreated}</strong>
          {" · форм: "}
          <strong>{summary.formsCreated}</strong>
          {" · пропусков: "}
          <strong>{summary.skipped}</strong>
          {" · ошибок: "}
          <strong>{summary.errors}</strong>
          {" · тип "}
          {packageKindLabel(packageKind)}
        </p>
      )}

      {displayRows.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Организация</th>
                <th>Период</th>
                <th>Статус</th>
                <th>Формы</th>
                <th>Замечания</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((r) => (
                <tr key={`${r.zid}-${r.eid ?? "new"}`}>
                  <td>{r.organizationName}</td>
                  <td>
                    {r.periodName}
                    {r.periodCreated ? (
                      <div className="table-sub">будет создан / создан</div>
                    ) : r.eid != null ? (
                      <div className="table-sub">существующий · {r.eid}</div>
                    ) : null}
                  </td>
                  <td>
                    <span
                      className={`status-badge ${
                        r.status === "error"
                          ? "returned"
                          : r.status === "created"
                            ? "accepted"
                            : "draft"
                      }`}
                      style={{ marginLeft: 0 }}
                    >
                      {r.status === "ready"
                        ? "Готово к созданию"
                        : r.status === "created"
                          ? "Создано"
                          : r.status === "skipped"
                            ? "Пропущено"
                            : "Ошибка"}
                    </span>
                  </td>
                  <td>
                    +{r.formsCreated} / всего {r.formsTotal}
                    {r.formsSkipped > 0 ? ` · пропуск ${r.formsSkipped}` : ""}
                  </td>
                  <td>
                    {r.error ? <span className="error">{r.error}</span> : null}
                    {!r.error && r.warnings.length
                      ? r.warnings.join("; ")
                      : !r.error
                        ? "—"
                        : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
