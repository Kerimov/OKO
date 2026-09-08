import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { loadSchema } from "../../api";
import { downloadBlob } from "../../engine/zipStore";
import { exportReportPackagesBulk } from "../../packagesApi";
import { packageKindLabel } from "../../uiLabels";
import { Button } from "../../components/ui";
import { loadPackageInstances, rowKey } from "./ExchangeShared";
import type { WorkspaceListApi } from "./useWorkspacePackageList";
import {
  ExchangePeriodSidebar,
  WorkspaceFilters,
  WorkspacePackagesTable,
} from "./ExchangeWorkspaceUi";

export interface PackageExportTabProps {
  list: WorkspaceListApi;
  onStatus?: (message: string) => void;
}

export function PackageExportTab({ list, onStatus }: PackageExportTabProps) {
  const [busy, setBusy] = useState(false);
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(() => new Set());

  const checkedRows = useMemo(
    () => list.filteredRows.filter((r) => checkedKeys.has(rowKey(r))),
    [list.filteredRows, checkedKeys]
  );
  const singleSelected = checkedRows.length === 1 ? checkedRows[0]! : null;
  const allFilteredChecked =
    list.filteredRows.length > 0 &&
    list.filteredRows.every((r) => checkedKeys.has(rowKey(r)));

  const toggleChecked = (key: string, checked: boolean) => {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    if (allFilteredChecked) {
      setCheckedKeys((prev) => {
        const next = new Set(prev);
        for (const r of list.filteredRows) next.delete(rowKey(r));
        return next;
      });
      return;
    }
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      for (const r of list.filteredRows) next.add(rowKey(r));
      return next;
    });
  };

  const handleDownloadSelected = async () => {
    if (!checkedRows.length) {
      onStatus?.("Отметьте один или несколько комплектов для скачивания");
      return;
    }
    setBusy(true);
    try {
      const result = await exportReportPackagesBulk(
        checkedRows.map((r) => ({ zid: r.zid, eid: r.eid }))
      );
      downloadBlob(result.blob, result.filename);
      await list.reloadWorkspace().catch(() => undefined);
      onStatus?.(
        checkedRows.length === 1
          ? `Скачан комплект: ${checkedRows[0]!.organizationName} → ${result.filename}`
          : `Скачано комплектов: ${result.exported}` +
              (result.failed ? ` · ошибок ${result.failed}` : "") +
              ` → ${result.filename}`
      );
    } catch (e) {
      onStatus?.(e instanceof Error ? e.message : "Ошибка выгрузки");
    } finally {
      setBusy(false);
    }
  };

  const handleExcelSelected = async () => {
    if (!singleSelected) {
      onStatus?.("Для Excel отметьте ровно один комплект");
      return;
    }
    setBusy(true);
    try {
      const instances = await loadPackageInstances(singleSelected.zid, singleSelected.eid);
      if (!instances.length) {
        onStatus?.("В выбранном комплекте нет форм");
        return;
      }
      const schemas = new Map(
        await Promise.all(
          [...new Set(instances.map((i) => i.templateId))].map(
            async (id) => [id, await loadSchema(id)] as const
          )
        )
      );
      const { exportPackageToExcel } = await import("../../engine/exportExcel");
      await exportPackageToExcel(instances, schemas);
      onStatus?.(
        `Excel: ${singleSelected.organizationName} · ${instances.length} форм`
      );
    } catch (e) {
      onStatus?.(e instanceof Error ? e.message : "Ошибка Excel");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="tools-section">
      <h2>Выгрузить комплекты</h2>
      <p>
        Сначала выберите <strong>период</strong> слева, затем отметьте комплекты
        организаций и скачайте ZIP.
      </p>
      <p className="hint-text">
        Создание периодов и комплектов — в <Link to="/package">Комплектах</Link>.
        Пустые комплекты скрыты по умолчанию.
      </p>
      {list.workspaceError ? (
        <p className="error-box">{list.workspaceError}</p>
      ) : null}

      <div className="package-workspace-layout exchange-layout">
        <ExchangePeriodSidebar
          campaigns={list.campaigns}
          selectedKey={list.selectedCampaignKey}
          loading={list.workspaceLoading}
          onSelect={list.setSelectedCampaignKey}
        />
        <div className="exchange-period-detail">
          {list.selectedCampaign ? (
            <header className="exchange-campaign-head">
              <h3>
                {list.selectedCampaign.periodName} ·{" "}
                {packageKindLabel(list.selectedCampaign.packageKind)}
              </h3>
              <p className="table-sub">
                {list.selectedCampaign.orgCount} организаций в периоде
              </p>
            </header>
          ) : null}

          <WorkspaceFilters filters={list.filters} />

          <div
            className="toolbar-actions"
            style={{ marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}
          >
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={allFilteredChecked}
                disabled={list.workspaceLoading || list.filteredRows.length === 0}
                onChange={toggleSelectAllFiltered}
              />
              Выбрать все в периоде ({list.filteredRows.length})
            </label>
            <Button
              disabled={busy || checkedRows.length === 0}
              onClick={() => void handleDownloadSelected()}
            >
              {busy
                ? "Выгрузка…"
                : checkedRows.length <= 1
                  ? `Скачать${checkedRows.length === 1 ? " комплект" : ""} (${checkedRows.length})`
                  : `Скачать выбранные (${checkedRows.length})`}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !singleSelected}
              onClick={() => void handleExcelSelected()}
              title="Excel только для одного отмеченного комплекта"
            >
              Excel
            </Button>
            <Button
              variant="secondary"
              disabled={list.workspaceLoading || busy}
              onClick={() =>
                void list.reloadWorkspace().catch((e) => {
                  onStatus?.(
                    e instanceof Error ? e.message : "Не удалось обновить список"
                  );
                })
              }
            >
              Обновить
            </Button>
          </div>

          <WorkspacePackagesTable
            rows={list.filteredRows}
            loading={list.workspaceLoading}
            campaign={list.selectedCampaign}
            selectable
            checkedKeys={checkedKeys}
            busy={busy}
            onToggle={toggleChecked}
          />
        </div>
      </div>
    </section>
  );
}
