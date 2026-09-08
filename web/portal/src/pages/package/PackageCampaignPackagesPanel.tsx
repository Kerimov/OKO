import type { RefObject } from "react";
import { Button } from "../../components/ui";
import type { PackageWorkspaceRow } from "../../types";
import type { VirtualRowsState } from "../../hooks/useVirtualRows";
import { BP_STATUS_LABEL, packageKindLabel, bpStatusLabel } from "../../uiLabels";
import { formatPeriod } from "../../utils";
import type { PackageKind } from "../../psdApi";
import { rowKey, type PeriodCampaign } from "./packageWorkspaceModel";

export const PACKAGE_ROW_HEIGHT = 56;

type Props = {
  campaign: PeriodCampaign;
  campaignPackages: PackageWorkspaceRow[];
  visiblePackages: PackageWorkspaceRow[];
  periodLocked: boolean;
  canMutate: boolean;
  admin: boolean;
  orgZid: number | null;
  busy: boolean;
  bpBusy: boolean;
  packageChecksBusy: boolean;
  canBulkSelect: boolean;
  canBulkStartCollection: boolean;
  canBulkRunChecks: boolean;
  canBulkDelete: boolean;
  filterBp: string;
  filterIncomplete: boolean;
  filterBlockers: boolean;
  checkedKeys: Set<string>;
  checkedRows: PackageWorkspaceRow[];
  checkedDeletableRows: PackageWorkspaceRow[];
  packageVirt: VirtualRowsState;
  scrollRef: RefObject<HTMLDivElement | null>;
  onOpenSettings: () => void;
  onFilterBpChange: (value: string) => void;
  onFilterIncompleteChange: (value: boolean) => void;
  onFilterBlockersChange: (value: boolean) => void;
  onToggleChecked: (key: string, checked: boolean) => void;
  onClearSelection: () => void;
  onSelectAll: () => void;
  onFillForms: (rows: PackageWorkspaceRow[]) => void;
  onBulkStartCollection: () => void;
  onBulkChecks: () => void;
  onBulkDelete: () => void;
  onOpenPackage: (zid: number, eid: number, kind: PackageKind) => void;
  onClosePeriodFor: (zid: number, eid: number) => void;
  onReopenPeriodFor: (zid: number, eid: number) => void;
  onDeletePackage: (row: PackageWorkspaceRow) => void;
};

export function PackageCampaignPackagesPanel({
  campaign,
  campaignPackages,
  visiblePackages,
  periodLocked,
  canMutate,
  admin,
  orgZid,
  busy,
  bpBusy,
  packageChecksBusy,
  canBulkSelect,
  canBulkStartCollection,
  canBulkRunChecks,
  canBulkDelete,
  filterBp,
  filterIncomplete,
  filterBlockers,
  checkedKeys,
  checkedRows,
  checkedDeletableRows,
  packageVirt,
  scrollRef,
  onOpenSettings,
  onFilterBpChange,
  onFilterIncompleteChange,
  onFilterBlockersChange,
  onToggleChecked,
  onClearSelection,
  onSelectAll,
  onFillForms,
  onBulkStartCollection,
  onBulkChecks,
  onBulkDelete,
  onOpenPackage,
  onClosePeriodFor,
  onReopenPeriodFor,
  onDeletePackage,
}: Props) {
  const fillableChecked = checkedRows.filter(
    (r) => r.periodStatus !== "closed" && r.filled < r.total
  );

  return (
    <section className="tools-section package-workspace-card">
      <div className="package-workspace-card-head">
        <div>
          <h2>
            {campaign.periodName}
            {" · "}
            {packageKindLabel(campaign.packageKind)}
          </h2>
          <p className="tools-hint package-workspace-card-meta">
            {campaign.periodStart && campaign.periodEnd
              ? formatPeriod(campaign.periodStart, campaign.periodEnd)
              : ""}
            {" · "}
            <strong>
              {campaign.status === "closed"
                ? "закрыт"
                : campaign.status === "mixed"
                  ? "частично закрыт"
                  : "открыт"}
            </strong>
            {` · ${campaign.orgCount} организаций`}
            {campaign.withoutForms ? ` · без форм: ${campaign.withoutForms}` : ""}
          </p>
        </div>
        <div className="toolbar-actions">
          {canMutate && (
            <Button variant="secondary" onClick={onOpenSettings}>
              Настройки периода
            </Button>
          )}
        </div>
      </div>

      {periodLocked ? (
        <p className="tools-hint" style={{ marginBottom: 12 }}>
          Период закрыт — заведение форм и добавление организаций недоступны.
        </p>
      ) : null}

      <div className="package-workspace-filters" style={{ marginBottom: 12 }}>
        <div className="tools-grid package-workspace-filter-grid">
          <label>
            Статус БП
            <select value={filterBp} onChange={(e) => onFilterBpChange(e.target.value)}>
              <option value="">Все</option>
              {Object.entries(BP_STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="package-workspace-checkboxes">
          <label>
            <input
              type="checkbox"
              checked={filterIncomplete}
              onChange={(e) => onFilterIncompleteChange(e.target.checked)}
            />{" "}
            Неполный
          </label>
          <label>
            <input
              type="checkbox"
              checked={filterBlockers}
              onChange={(e) => onFilterBlockersChange(e.target.checked)}
            />{" "}
            Есть блокеры
          </label>
        </div>
      </div>

      {canBulkSelect && (
        <div className="package-workspace-bulk-bar" style={{ marginBottom: 12 }}>
          <label className="package-workspace-bulk-select-all">
            <input
              type="checkbox"
              checked={
                campaignPackages.length > 0 &&
                campaignPackages.every((r) => checkedKeys.has(rowKey(r)))
              }
              disabled={busy || campaignPackages.length === 0}
              onChange={(e) => {
                if (e.target.checked) onSelectAll();
                else onClearSelection();
              }}
            />{" "}
            Выбрать все ({campaignPackages.length})
          </label>
          {checkedRows.length > 0 ? (
            <div className="package-workspace-bulk-actions">
              {canMutate && !periodLocked && (
                <Button
                  size="sm"
                  disabled={busy || fillableChecked.length === 0}
                  onClick={() => onFillForms(fillableChecked)}
                >
                  Завести формы
                  {fillableChecked.length ? ` (${fillableChecked.length})` : ""}
                </Button>
              )}
              {canBulkStartCollection && (
                <Button
                  size="sm"
                  disabled={busy || bpBusy}
                  onClick={onBulkStartCollection}
                >
                  {bpBusy ? "Запуск…" : "Запустить сбор"}
                </Button>
              )}
              {canBulkRunChecks && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy || packageChecksBusy}
                  onClick={onBulkChecks}
                >
                  {packageChecksBusy ? "Проверки…" : "Запустить проверки"}
                </Button>
              )}
              {canBulkDelete && (
                <Button
                  variant="danger-outline"
                  size="sm"
                  disabled={busy || checkedDeletableRows.length === 0}
                  onClick={onBulkDelete}
                >
                  Удалить
                  {checkedDeletableRows.length > 0
                    ? ` (${checkedDeletableRows.length})`
                    : ""}
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={onClearSelection}
              >
                Снять выбор
              </Button>
            </div>
          ) : null}
        </div>
      )}

      <div
        className="table-wrap"
        ref={scrollRef}
        style={
          packageVirt.enabled
            ? { maxHeight: "min(70vh, 720px)", overflow: "auto" }
            : undefined
        }
      >
        <table className="data-table">
          <thead>
            <tr>
              {canBulkSelect ? <th /> : null}
              <th>Организация</th>
              <th>Формы</th>
              <th>БП</th>
              <th>Период</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {packageVirt.enabled && packageVirt.offsetTop > 0 ? (
              <tr aria-hidden>
                <td
                  colSpan={canBulkSelect ? 6 : 5}
                  style={{
                    height: packageVirt.offsetTop,
                    padding: 0,
                    border: "none",
                  }}
                />
              </tr>
            ) : null}
            {visiblePackages.map((r) => {
              const key = rowKey(r);
              const closed = r.periodStatus === "closed";
              const canClose = !closed && r.bpStatus === "completed";
              const canCheck = canBulkSelect && (orgZid == null || r.zid === orgZid);
              return (
                <tr key={key} style={{ height: PACKAGE_ROW_HEIGHT }}>
                  {canBulkSelect ? (
                    <td>
                      <input
                        type="checkbox"
                        checked={checkedKeys.has(key)}
                        disabled={busy || !canCheck}
                        onChange={(e) => onToggleChecked(key, e.target.checked)}
                        aria-label={`Выбрать ${r.organizationName}`}
                      />
                    </td>
                  ) : null}
                  <td>
                    {r.organizationName}
                    {r.organizationCode ? (
                      <div className="table-sub">{r.organizationCode}</div>
                    ) : null}
                  </td>
                  <td>
                    {r.filled}/{r.total}
                    <div className="table-sub">сдано {r.submitted}</div>
                  </td>
                  <td>
                    {r.bpStatus ? bpStatusLabel(r.bpStatus) : "—"}
                    {r.hasBlockers ? <div className="table-sub">блокеры</div> : null}
                  </td>
                  <td>{closed ? "закрыт" : "открыт"}</td>
                  <td>
                    <div className="toolbar-actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={busy}
                        onClick={() => onOpenPackage(r.zid, r.eid, r.packageKind)}
                      >
                        Открыть
                      </button>
                      {!periodLocked && !closed && r.filled < r.total && canMutate && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={busy}
                          onClick={() => onFillForms([r])}
                        >
                          {r.filled === 0 ? "Завести формы" : "Дозавести формы"}
                        </button>
                      )}
                      {!periodLocked && canClose && canMutate && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={busy}
                          onClick={() => onClosePeriodFor(r.zid, r.eid)}
                        >
                          Закрыть
                        </button>
                      )}
                      {closed && canMutate && !periodLocked && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={busy}
                          onClick={() => onReopenPeriodFor(r.zid, r.eid)}
                        >
                          Переоткрыть
                        </button>
                      )}
                      {canMutate && (admin || (orgZid != null && r.zid === orgZid)) && (
                        <button
                          type="button"
                          className="btn btn-danger-outline"
                          disabled={busy}
                          onClick={() => onDeletePackage(r)}
                        >
                          Удалить
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {packageVirt.enabled && packageVirt.offsetBottom > 0 ? (
              <tr aria-hidden>
                <td
                  colSpan={canBulkSelect ? 6 : 5}
                  style={{
                    height: packageVirt.offsetBottom,
                    padding: 0,
                    border: "none",
                  }}
                />
              </tr>
            ) : null}
            {!campaignPackages.length && (
              <tr>
                <td colSpan={canBulkSelect ? 6 : 5}>
                  В периоде нет комплектов по фильтру.
                  {canMutate ? " Создайте комплекты кнопкой выше." : ""}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
