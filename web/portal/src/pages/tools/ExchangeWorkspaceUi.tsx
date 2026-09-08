import { Link } from "react-router-dom";
import { CollapsibleFilters, countActiveFilters } from "../../components/CollapsibleFilters";
import type { PackageWorkspaceRow } from "../../types";
import { bpStatusLabel, packageKindLabel } from "../../uiLabels";
import { formatPeriod } from "../../utils";
import { StatusBadge } from "../../components/ui";
import { ExchangeMarksCell, rowKey, type UploadMarkFilter } from "./ExchangeShared";
import type { ExchangeCampaign, WorkspaceListApi } from "./useWorkspacePackageList";

export function ExchangePeriodSidebar({
  campaigns,
  selectedKey,
  loading,
  onSelect,
}: {
  campaigns: ExchangeCampaign[];
  selectedKey: string;
  loading: boolean;
  onSelect: (key: string) => void;
}) {
  return (
    <aside className="tools-section exchange-period-list" aria-label="Периоды">
      <h3>Периоды</h3>
      <p className="table-sub">
        {loading ? "Загрузка…" : `Периодов: ${campaigns.length}`}
      </p>
      <div className="exchange-period-scroll">
        {campaigns.map((c) => {
          const selected = c.key === selectedKey;
          return (
            <button
              key={c.key}
              type="button"
              className={`package-workspace-item${selected ? " is-selected" : ""}`}
              onClick={() => onSelect(c.key)}
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
                          ? "частично"
                          : "открыт"
                    }
                  />
                  <span className="table-sub">
                    {c.orgCount} орг. · с формами {c.withForms}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
        {!loading && !campaigns.length && (
          <p className="tools-hint">Нет периодов для обмена</p>
        )}
      </div>
    </aside>
  );
}

export function WorkspaceFilters({
  filters,
  showUploadMarkFilter,
}: {
  filters: WorkspaceListApi["filters"];
  showUploadMarkFilter?: boolean;
}) {
  const {
    bulkSearch,
    setBulkSearch,
    bulkBp,
    setBulkBp,
    bulkOnlyFilled,
    setBulkOnlyFilled,
    hideEmpty,
    setHideEmpty,
    uploadMark,
    setUploadMark,
  } = filters;

  return (
    <CollapsibleFilters
      activeCount={countActiveFilters(
        bulkSearch.trim().length > 0,
        bulkBp !== "",
        bulkOnlyFilled,
        !hideEmpty,
        Boolean(showUploadMarkFilter && uploadMark)
      )}
      bodyClassName="tools-grid"
    >
      <label>
        Поиск организации
        <input
          type="search"
          value={bulkSearch}
          onChange={(e) => setBulkSearch(e.target.value)}
          placeholder="Название, код, ZID…"
        />
      </label>
      <label>
        Статус БП
        <select value={bulkBp} onChange={(e) => setBulkBp(e.target.value)}>
          <option value="">Все</option>
          <option value="not_started">{bpStatusLabel("not_started")}</option>
          <option value="collecting">{bpStatusLabel("collecting")}</option>
          <option value="pending_curator_approval">
            {bpStatusLabel("pending_curator_approval")}
          </option>
          <option value="curator_approved">{bpStatusLabel("curator_approved")}</option>
          <option value="completed">{bpStatusLabel("completed")}</option>
        </select>
      </label>
      {showUploadMarkFilter && (
        <label>
          Загрузка
          <select
            value={uploadMark}
            onChange={(e) => setUploadMark(e.target.value as UploadMarkFilter)}
          >
            <option value="">Все</option>
            <option value="pending">Не загружено</option>
            <option value="imported">Уже загружено</option>
          </select>
        </label>
      )}
      <label className="checkbox-inline" style={{ alignSelf: "end" }}>
        <input
          type="checkbox"
          checked={bulkOnlyFilled}
          onChange={(e) => setBulkOnlyFilled(e.target.checked)}
        />
        Только полные
      </label>
      <label className="checkbox-inline" style={{ alignSelf: "end" }}>
        <input
          type="checkbox"
          checked={hideEmpty}
          onChange={(e) => setHideEmpty(e.target.checked)}
        />
        Скрыть пустые
      </label>
    </CollapsibleFilters>
  );
}

export function WorkspacePackagesTable({
  rows,
  loading,
  campaign,
  selectable,
  checkedKeys,
  busy,
  onToggle,
  highlightImported,
  showExportedMark = true,
}: {
  rows: PackageWorkspaceRow[];
  loading: boolean;
  campaign: ExchangeCampaign | null;
  selectable?: boolean;
  checkedKeys?: Set<string>;
  busy?: boolean;
  onToggle?: (key: string, checked: boolean) => void;
  highlightImported?: boolean;
  showExportedMark?: boolean;
}) {
  if (loading) {
    return <p className="hint-text">Загрузка комплектов…</p>;
  }
  if (!campaign) {
    return <p className="hint-text">Выберите период слева.</p>;
  }
  return (
    <div className="table-wrap exchange-table-wrap">
      <table className="form-table exchange-packages-table">
        <thead>
          <tr>
            {selectable ? <th className="table-col-check" /> : null}
            <th>Организация</th>
            <th>GUID</th>
            <th>Формы</th>
            <th>Обмен</th>
            <th>БП</th>
            <th>Период орг.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const key = rowKey(r);
            const imported = Boolean(r.lastImportedAt);
            return (
              <tr
                key={key}
                className={
                  highlightImported && imported ? "exchange-row-imported" : undefined
                }
              >
                {selectable ? (
                  <td>
                    <input
                      type="checkbox"
                      checked={checkedKeys?.has(key) ?? false}
                      disabled={busy}
                      onChange={(e) => onToggle?.(key, e.target.checked)}
                      aria-label={`Выбрать ${r.organizationName}`}
                    />
                  </td>
                ) : null}
                <td>
                  <div>{r.organizationName}</div>
                  <div className="table-sub">
                    ZID {r.zid}
                    {r.organizationCode ? ` · ${r.organizationCode}` : ""}
                    {" · "}
                    <Link to={`/package?zid=${r.zid}&eid=${r.eid}`}>комплект</Link>
                  </div>
                </td>
                <td>
                  <code className="exchange-guid" title={r.packageId}>
                    {r.packageId.slice(0, 8)}…
                  </code>
                  <div className="table-sub">EID {r.eid}</div>
                </td>
                <td>
                  {r.filled}/{r.total} · сдано {r.submitted}
                  <div className="table-sub">{r.percent}%</div>
                </td>
                <td>
                  <ExchangeMarksCell row={r} showExported={showExportedMark} />
                </td>
                <td>
                  {r.bpStatus ? (
                    <StatusBadge
                      status={r.bpStatus}
                      label={bpStatusLabel(r.bpStatus)}
                    />
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <StatusBadge
                    tone={r.periodStatus === "closed" ? "returned" : "accepted"}
                    label={r.periodStatus === "closed" ? "закрыт" : "открыт"}
                  />
                  <div className="table-sub">EID {r.eid}</div>
                </td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr>
              <td colSpan={selectable ? 7 : 6}>
                Нет комплектов в этом периоде по фильтрам
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
