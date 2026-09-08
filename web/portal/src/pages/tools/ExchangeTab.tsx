import { useEffect, useState } from "react";
import type { ExchangeMode } from "./tabs";
import { usePackageInbox } from "./usePackageInbox";
import { useWorkspacePackageList } from "./useWorkspacePackageList";
import { PackageExportTab } from "./PackageExportTab";
import { PackageUploadTab } from "./PackageUploadTab";

export interface ExchangeTabProps {
  mode: ExchangeMode;
  onModeChange: (mode: ExchangeMode) => void;
  onStatus?: (message: string) => void;
  onImported?: () => void;
  workZid?: number | null;
  workEid?: number | null;
}

export function ExchangeTab({
  mode,
  onModeChange,
  onStatus,
  onImported,
  workZid = null,
  workEid = null,
}: ExchangeTabProps) {
  const list = useWorkspacePackageList();
  const [importOverwrite, setImportOverwrite] = useState(false);
  const inbox = usePackageInbox({
    importOverwrite,
    workZid,
    workEid,
    onStatus,
    onImported,
  });

  useEffect(() => {
    void list.reloadWorkspace().catch((e) => {
      onStatus?.(
        e instanceof Error ? e.message : "Не удалось загрузить список комплектов"
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="tools-subtabs" role="tablist" aria-label="Обмен комплектами">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "export"}
          className={mode === "export" ? "active" : undefined}
          onClick={() => onModeChange("export")}
        >
          Выгрузить
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "upload"}
          className={mode === "upload" ? "active" : undefined}
          onClick={() => onModeChange("upload")}
        >
          Загрузить
        </button>
      </div>
      {mode === "export" ? (
        <PackageExportTab list={list} onStatus={onStatus} />
      ) : (
        <PackageUploadTab
          list={list}
          importOverwrite={importOverwrite}
          onImportOverwriteChange={setImportOverwrite}
          onStatus={onStatus}
          onImported={onImported}
          inbox={inbox}
        />
      )}
    </>
  );
}


