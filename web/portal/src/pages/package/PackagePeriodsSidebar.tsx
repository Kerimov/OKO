import { CollapsibleFilters, countActiveFilters } from "../../components/CollapsibleFilters";
import { Button, StatusBadge } from "../../components/ui";
import { formatPeriod } from "../../utils";
import { packageKindLabel } from "../../uiLabels";
import type { PeriodCampaign } from "./packageWorkspaceModel";

type Props = {
  campaigns: PeriodCampaign[];
  selectedCampaignKey: string;
  listSearch: string;
  filterKind: string;
  filterPeriod: string;
  canMutate: boolean;
  admin: boolean;
  onListSearchChange: (value: string) => void;
  onFilterKindChange: (value: string) => void;
  onFilterPeriodChange: (value: string) => void;
  onSelectCampaign: (key: string) => void;
  onOpenPeriod: () => void;
  onOpenSetup: () => void;
};

export function PackagePeriodsSidebar({
  campaigns,
  selectedCampaignKey,
  listSearch,
  filterKind,
  filterPeriod,
  canMutate,
  admin,
  onListSearchChange,
  onFilterKindChange,
  onFilterPeriodChange,
  onSelectCampaign,
  onOpenPeriod,
  onOpenSetup,
}: Props) {
  return (
    <aside className="tools-section package-workspace-list">
      <h2>Кампании</h2>
      <CollapsibleFilters
        activeCount={countActiveFilters(
          listSearch.trim().length > 0,
          filterKind !== "",
          filterPeriod !== ""
        )}
        bodyClassName="package-workspace-filters"
      >
        <input
          type="search"
          className="search-input"
          placeholder="Поиск кампании…"
          value={listSearch}
          onChange={(e) => onListSearchChange(e.target.value)}
        />
        <div className="tools-grid package-workspace-filter-grid">
          <label>
            Тип
            <select value={filterKind} onChange={(e) => onFilterKindChange(e.target.value)}>
              <option value="">Все</option>
              <option value="OKO">ОКО</option>
              <option value="BALANCE">Баланс</option>
            </select>
          </label>
          <label>
            Статус
            <select
              value={filterPeriod}
              onChange={(e) => onFilterPeriodChange(e.target.value)}
            >
              <option value="">Все</option>
              <option value="open">Открыт</option>
              <option value="closed">Закрыт</option>
            </select>
          </label>
        </div>
      </CollapsibleFilters>
      <p className="package-workspace-list-totals table-sub">
        Кампаний: {campaigns.length}
      </p>

      <div className="package-workspace-list-scroll">
        {campaigns.map((c) => {
          const selected = c.key === selectedCampaignKey;
          return (
            <button
              key={c.key}
              type="button"
              className={`package-workspace-item${selected ? " is-selected" : ""}`}
              onClick={() => onSelectCampaign(c.key)}
            >
              <div className="package-workspace-item-body">
                <div className="package-workspace-item-title">{c.periodName}</div>
                <div className="package-workspace-item-meta">
                  {packageKindLabel(c.packageKind)}
                  {c.periodStart && c.periodEnd
                    ? ` · ${formatPeriod(c.periodStart, c.periodEnd)}`
                    : ""}
                </div>
                <div className="package-workspace-item-stats">
                  <StatusBadge
                    tone={
                      c.status === "closed"
                        ? "returned"
                        : c.status === "mixed"
                          ? "draft"
                          : "accepted"
                    }
                    label={
                      c.status === "closed"
                        ? "закрыт"
                        : c.status === "mixed"
                          ? "частично закрыт"
                          : "открыт"
                    }
                  />
                  <span className="table-sub">
                    {c.orgCount} орг.
                    {c.withoutForms ? ` · без форм: ${c.withoutForms}` : ""}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
        {!campaigns.length && <p className="tools-hint">Периодов пока нет</p>}
      </div>

      {canMutate && (
        <Button
          variant="secondary"
          size="sm"
          className="package-workspace-create-btn"
          onClick={onOpenPeriod}
        >
          Открыть кампанию…
        </Button>
      )}
      {admin && canMutate && (
        <Button
          variant="secondary"
          size="sm"
          className="package-workspace-create-btn"
          onClick={onOpenSetup}
        >
          Настройка
        </Button>
      )}
    </aside>
  );
}
