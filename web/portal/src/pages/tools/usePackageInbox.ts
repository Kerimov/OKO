import { useCallback, useEffect, useState } from "react";
import { readReportPackageFile } from "../../engine/packageExport";
import {
  acceptPackageInbox,
  getPackageInboxDetail,
  listPackageInbox,
  previewPackageInbox,
  receivePackageInbox,
  rejectPackageInbox,
  type PackageInboxItem,
} from "../../packagesApi";
import { isBackendMode } from "../../storage";

type InboxApi = {
  backend: boolean;
  items: PackageInboxItem[];
  onRefresh: () => void;
  onQuarantineFile: (file: File) => void;
  onPreview: (id: string) => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
};

/**
 * Inbox/quarantine queue for package upload (backend only).
 * Keeps exchange UI self-contained instead of living in ToolsPage.
 */
export function usePackageInbox(opts: {
  importOverwrite: boolean;
  workZid: number | null;
  workEid: number | null;
  onStatus?: (message: string) => void;
  onImported?: () => void;
}): InboxApi | undefined {
  const backend = isBackendMode();
  const [items, setItems] = useState<PackageInboxItem[]>([]);
  const { importOverwrite, workZid, workEid, onStatus, onImported } = opts;

  const refresh = useCallback(() => {
    void listPackageInbox()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    if (!backend) return;
    refresh();
  }, [backend, refresh]);

  if (!backend) return undefined;

  return {
    backend: true,
    items,
    onRefresh: refresh,
    onQuarantineFile: (file) => {
      void (async () => {
        try {
          const pkg = await readReportPackageFile(file);
          const rawJson = JSON.stringify(pkg);
          await receivePackageInbox({
            rawJson,
            filename: file.name,
            targetZid: pkg.zid ?? workZid,
            targetEid: pkg.eid ?? workEid,
          });
          setItems(await listPackageInbox());
          onStatus?.(`В очередь: ${file.name}`);
        } catch (e) {
          onStatus?.(e instanceof Error ? e.message : "Ошибка загрузки в очередь");
        }
      })();
    },
    onPreview: (id) => {
      void (async () => {
        try {
          const detail = await getPackageInboxDetail(id);
          const zid =
            Number(detail.packageJson.zid ?? detail.pkgZid ?? workZid) || null;
          const eid =
            Number(detail.packageJson.eid ?? detail.pkgEid ?? workEid) || null;
          if (zid == null || eid == null) {
            onStatus?.(
              "В файле очереди нет zid/eid — выберите комплект в «Комплектах»"
            );
            return;
          }
          const preview = await previewPackageInbox(id, { zid, eid });
          onStatus?.(
            `Очередь превью → орг. ${zid}, период ${eid}: +${preview.summary.new} новых, ~${preview.summary.changed} изменённых`
          );
        } catch (e) {
          onStatus?.(e instanceof Error ? e.message : "Ошибка превью очереди");
        }
      })();
    },
    onAccept: (id) => {
      void (async () => {
        try {
          const detail = await getPackageInboxDetail(id);
          const zid =
            Number(detail.packageJson.zid ?? detail.pkgZid ?? workZid) || null;
          const eid =
            Number(detail.packageJson.eid ?? detail.pkgEid ?? workEid) || null;
          if (zid == null || eid == null) {
            onStatus?.(
              "В файле очереди нет zid/eid — выберите комплект в «Комплектах»"
            );
            return;
          }
          const r = await acceptPackageInbox(id, {
            zid,
            eid,
            overwrite: importOverwrite,
          });
          setItems(await listPackageInbox());
          onImported?.();
          onStatus?.(
            `Очередь принята → ${zid}/${eid}: +${r.result.created} / ≈${r.result.updated}`
          );
        } catch (e) {
          onStatus?.(e instanceof Error ? e.message : "Ошибка приёма из очереди");
        }
      })();
    },
    onReject: (id) => {
      void (async () => {
        try {
          await rejectPackageInbox(id, "Отклонено оператором");
          setItems(await listPackageInbox());
          onStatus?.("Очередь: отклонено");
        } catch (e) {
          onStatus?.(e instanceof Error ? e.message : "Ошибка отклонения");
        }
      })();
    },
  };
}
