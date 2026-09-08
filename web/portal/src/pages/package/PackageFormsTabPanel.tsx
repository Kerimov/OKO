import { Link } from "react-router-dom";
import { CollapsibleFilters, countActiveFilters } from "../../components/CollapsibleFilters";
import { Button, StatusBadge } from "../../components/ui";
import type { PackageCompleteness, PackageWorkspaceRow } from "../../types";
import { formStatusLabel } from "../../utils";
import type { FormFilter } from "./packageWorkspaceModel";

type FormItem = NonNullable<PackageCompleteness["items"]>[number];

type Props = {
  completeness: PackageCompleteness | null;
  formItems: FormItem[];
  formSearch: string;
  formFilter: FormFilter;
  canMutate: boolean;
  periodClosed: boolean;
  busy: boolean;
  selectedRow: PackageWorkspaceRow | null;
  onFormSearchChange: (value: string) => void;
  onFormFilterChange: (value: FormFilter) => void;
  onFillForms: () => void;
};

export function PackageFormsTabPanel({
  completeness,
  formItems,
  formSearch,
  formFilter,
  canMutate,
  periodClosed,
  busy,
  selectedRow,
  onFormSearchChange,
  onFormFilterChange,
  onFillForms,
}: Props) {
  return (
    <section className="tools-section">
      <h2>
        Формы{" "}
        <span className="cat-count">
          {completeness ? `${completeness.filled}/${completeness.total}` : "—"}
        </span>
      </h2>
      <CollapsibleFilters
        activeCount={countActiveFilters(formSearch.trim().length > 0, formFilter !== "all")}
        bodyClassName="tools-grid"
      >
        <label>
          Поиск
          <input
            type="search"
            value={formSearch}
            onChange={(e) => onFormSearchChange(e.target.value)}
            placeholder="Код, название, категория…"
          />
        </label>
        <label>
          Фильтр
          <select
            value={formFilter}
            onChange={(e) => onFormFilterChange(e.target.value as FormFilter)}
          >
            <option value="all">Все</option>
            <option value="filled">Заведено</option>
            <option value="draft">Черновики</option>
            <option value="submitted">Сдано</option>
            <option value="missing">Не заведено</option>
          </select>
        </label>
      </CollapsibleFilters>
      {canMutate && !periodClosed && selectedRow && (
        <div className="toolbar-actions section-actions">
          <Button
            variant="secondary"
            disabled={busy || selectedRow.filled >= selectedRow.total}
            onClick={onFillForms}
          >
            Завести / дозавести
          </Button>
        </div>
      )}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Форма</th>
              <th>Категория</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {formItems.map((f) => (
              <tr key={f.formId}>
                <td>
                  <div>{f.title}</div>
                  <div className="table-sub">{f.formId}</div>
                </td>
                <td>{f.category || "—"}</td>
                <td>
                  {f.filled ? (
                    <StatusBadge
                      status={f.status ?? "draft"}
                      label={formStatusLabel(f.status)}
                    />
                  ) : (
                    <StatusBadge tone="not_started" label="Не заведена" />
                  )}
                </td>
                <td>
                  {f.instanceId ? (
                    <Link to={`/my/${f.instanceId}`} className="btn btn-secondary btn-sm">
                      Открыть
                    </Link>
                  ) : (
                    <Link to="/catalog" className="btn btn-secondary btn-sm">
                      Каталог
                    </Link>
                  )}
                </td>
              </tr>
            ))}
            {!formItems.length && (
              <tr>
                <td colSpan={4}>Нет форм по фильтру</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
