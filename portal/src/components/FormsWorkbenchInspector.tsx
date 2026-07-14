import { useEffect, useState, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchFormDependencies, type FormCellDefinitionDto } from "../api";

export interface FormsWorkbenchSelection {
  rowIndex: number;
  columnKey: string;
  rowNo: string;
}

interface Props {
  formId: string;
  selection: FormsWorkbenchSelection | null;
  cellDefs: FormCellDefinitionDto[];
  onDeleteCellDef?: (rowId: string, columnKey: string) => void;
  /** Open Dependencies tab for the current form (recalc / overview in-place). */
  onOpenDeps?: () => void;
  backend: boolean;
}

const KIND_ORDER = [
  "check",
  "rash",
  "saldo",
  "recalc",
  "correspondence",
  "excel",
  "instance",
] as const;

const KIND_LABEL: Record<string, string> = {
  check: "Увязки",
  rash: "Расшифровки",
  saldo: "Сальдо",
  recalc: "Пересчёт",
  correspondence: "Соответствие",
  excel: "Excel",
  instance: "Экземпляры",
};

/** Destinations for dependency hits from the forms workbench inspector. */
export function dependencyHref(
  kind: string,
  ref: string,
  formId: string
): string {
  const enc = encodeURIComponent(ref);
  const fid = encodeURIComponent(formId);
  switch (kind) {
    case "check":
      return `/admin/checks?q=${enc}`;
    case "rash":
      return `/admin/rash?kod=${enc}`;
    case "saldo":
      return `/admin/saldo?q=${enc}`;
    case "correspondence":
      return `/admin/saldo?tab=correspondence&formId=${fid}&field=${enc}`;
    case "recalc":
      return `/admin/forms?form=${fid}&tab=deps`;
    case "excel":
      return `/admin/excel?formId=${fid}`;
    case "instance":
      return `/my?templateId=${fid}`;
    default:
      return `/admin/forms?form=${fid}&tab=deps`;
  }
}

/**
 * Inspector docked under the grid: cell defs + OKO rule hits with working links.
 */
export function FormsWorkbenchInspector({
  formId,
  selection,
  cellDefs,
  onDeleteCellDef,
  onOpenDeps,
  backend,
}: Props) {
  const navigate = useNavigate();
  const [deps, setDeps] = useState<Awaited<
    ReturnType<typeof fetchFormDependencies>
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!backend || !formId) {
      setDeps(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    void fetchFormDependencies(formId, {
      columnKey: selection?.columnKey,
      rowNo: selection?.rowNo || undefined,
    })
      .then((d) => {
        if (!cancelled) setDeps(d);
      })
      .catch(() => {
        if (!cancelled) setDeps(null);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [backend, formId, selection?.columnKey, selection?.rowNo]);

  useEffect(() => {
    if (selection) setOpen(true);
  }, [selection?.columnKey, selection?.rowNo, selection?.rowIndex]);

  const matchingDefs = cellDefs.filter((d) => {
    if (!selection) return false;
    if (d.columnKey !== selection.columnKey) return false;
    if (!selection.rowNo) return true;
    return d.rowId.includes(selection.rowNo) || d.rowId.endsWith(`:${selection.rowNo}`);
  });

  const byKind = (kind: string) => deps?.hits.filter((h) => h.kind === kind) ?? [];

  const go = (kind: string, ref: string, e?: MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    // Recalc rules live as JSON — show Dependencies for this form in the constructor.
    if ((kind === "recalc" || kind === "instance") && onOpenDeps && (ref === formId || !ref)) {
      onOpenDeps();
      return;
    }
    if (kind === "recalc" && onOpenDeps && ref === formId) {
      onOpenDeps();
      return;
    }
    navigate(dependencyHref(kind, ref, formId));
  };

  return (
    <aside className={`forms-workbench-inspector${open ? " is-open" : ""}`}>
      <div className="forms-workbench-inspector-bar">
        <button
          type="button"
          className="forms-workbench-inspector-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span>Инспектор</span>
          {selection ? (
            <code>
              {selection.columnKey}
              {selection.rowNo ? ` · стр. ${selection.rowNo}` : ` · #${selection.rowIndex}`}
            </code>
          ) : (
            <span className="muted">ячейка не выбрана</span>
          )}
          <span className="forms-workbench-inspector-chevron" aria-hidden>
            {open ? "▾" : "▸"}
          </span>
        </button>
      </div>

      {open && (
        <div className="forms-workbench-inspector-body">
          <div className="forms-workbench-inspector-cols">
            <section>
              <h4>Определение ячейки</h4>
              {!selection ? (
                <p className="muted">Выберите ячейку в сетке.</p>
              ) : matchingDefs.length === 0 ? (
                <p className="muted">Нет formula/style в form_cell_definitions.</p>
              ) : (
                <ul className="rash-validation">
                  {matchingDefs.map((d) => (
                    <li key={`${d.rowId}:${d.columnKey}`}>
                      <div>
                        <code>{d.formulaA1 ?? "—"}</code>
                        {d.readonly ? " · чт." : ""}
                      </div>
                      {onDeleteCellDef && (
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => onDeleteCellDef(d.rowId, d.columnKey)}
                        >
                          Удалить
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h4>Правила OKO</h4>
              {!backend ? (
                <p className="muted">Нужен API.</p>
              ) : busy ? (
                <p className="muted">Загрузка зависимостей…</p>
              ) : !deps ? (
                <p className="muted">Нет данных.</p>
              ) : (
                <>
                  <p className="tools-hint">
                    {Object.entries(deps.totals)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(" · ") || "Связей не найдено"}
                  </p>
                  {KIND_ORDER.map((kind) => {
                    const label = KIND_LABEL[kind];
                    const hits = byKind(kind);
                    if (!hits.length || !label) return null;
                    const sectionTo = dependencyHref(kind, formId, formId);
                    return (
                      <div key={kind} className="forms-workbench-inspector-kind">
                        <div className="forms-workbench-inspector-kind-head">
                          <strong>{label}</strong>
                          <Link
                            to={sectionTo}
                            className="forms-workbench-inspector-link"
                            onClick={(e) => {
                              if (kind === "recalc" && onOpenDeps) {
                                e.preventDefault();
                                onOpenDeps();
                              }
                            }}
                          >
                            открыть
                          </Link>
                        </div>
                        <ul className="rash-validation forms-workbench-inspector-hits">
                          {hits.slice(0, 8).map((h) => (
                            <li key={`${kind}-${h.ref}-${h.detail}`}>
                              <Link
                                to={dependencyHref(kind, h.ref, formId)}
                                className="forms-workbench-inspector-link"
                                onClick={(e) => go(kind, h.ref, e)}
                              >
                                <code>{h.ref}</code>
                              </Link>
                              <span className="muted"> — {h.detail}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </>
              )}
            </section>
          </div>
        </div>
      )}
    </aside>
  );
}
