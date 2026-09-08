import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchPackageWorkspace } from "../../packagesApi";
import type { PackageWorkspaceRow } from "../../types";
import type { UploadMarkFilter } from "./ExchangeShared";

export type ExchangeCampaign = {
  key: string;
  periodName: string;
  packageKind: PackageWorkspaceRow["packageKind"];
  periodStart: string | null;
  periodEnd: string | null;
  orgCount: number;
  withForms: number;
  status: "open" | "closed" | "mixed";
};

function campaignKeyOf(r: {
  periodName: string;
  packageKind: string;
}): string {
  return `${r.periodName}||${r.packageKind}`;
}

export function useWorkspacePackageList() {
  const [workspaceRows, setWorkspaceRows] = useState<PackageWorkspaceRow[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [selectedCampaignKey, setSelectedCampaignKey] = useState("");
  const [bulkSearch, setBulkSearch] = useState("");
  const [bulkBp, setBulkBp] = useState("");
  const [bulkOnlyFilled, setBulkOnlyFilled] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(true);
  const [uploadMark, setUploadMark] = useState<UploadMarkFilter>("");

  const reloadWorkspace = useCallback(async () => {
    setWorkspaceLoading(true);
    setWorkspaceError("");
    try {
      const rows = await fetchPackageWorkspace();
      setWorkspaceRows(rows);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Не удалось загрузить список комплектов";
      setWorkspaceError(msg);
      throw e instanceof Error ? e : new Error(msg);
    } finally {
      setWorkspaceLoading(false);
    }
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void reloadWorkspace().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [reloadWorkspace]);

  const campaigns = useMemo(() => {
    const map = new Map<string, ExchangeCampaign & { openCount: number; closedCount: number }>();
    for (const r of workspaceRows) {
      if (hideEmpty && r.filled === 0 && !r.lastExportedAt && !r.lastImportedAt) {
        continue;
      }
      const key = campaignKeyOf(r);
      const prev = map.get(key);
      if (prev) {
        prev.orgCount += 1;
        if (r.filled > 0) prev.withForms += 1;
        if (r.periodStatus === "closed") prev.closedCount += 1;
        else prev.openCount += 1;
      } else {
        map.set(key, {
          key,
          periodName: r.periodName,
          packageKind: r.packageKind,
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
          orgCount: 1,
          withForms: r.filled > 0 ? 1 : 0,
          status: r.periodStatus === "closed" ? "closed" : "open",
          openCount: r.periodStatus === "closed" ? 0 : 1,
          closedCount: r.periodStatus === "closed" ? 1 : 0,
        });
      }
    }
    const list: ExchangeCampaign[] = [];
    for (const c of map.values()) {
      list.push({
        key: c.key,
        periodName: c.periodName,
        packageKind: c.packageKind,
        periodStart: c.periodStart,
        periodEnd: c.periodEnd,
        orgCount: c.orgCount,
        withForms: c.withForms,
        status:
          c.openCount > 0 && c.closedCount > 0
            ? "mixed"
            : c.closedCount > 0
              ? "closed"
              : "open",
      });
    }
    return list.sort((a, b) => {
      const ae = a.periodEnd ?? "";
      const be = b.periodEnd ?? "";
      if (ae !== be) return be.localeCompare(ae);
      return a.periodName.localeCompare(b.periodName, "ru");
    });
  }, [workspaceRows, hideEmpty]);

  useEffect(() => {
    if (!campaigns.length) {
      if (selectedCampaignKey) setSelectedCampaignKey("");
      return;
    }
    if (!campaigns.some((c) => c.key === selectedCampaignKey)) {
      setSelectedCampaignKey(campaigns[0]!.key);
    }
  }, [campaigns, selectedCampaignKey]);

  const selectedCampaign =
    campaigns.find((c) => c.key === selectedCampaignKey) ?? null;

  const filteredRows = useMemo(() => {
    if (!selectedCampaignKey) return [];
    const q = bulkSearch.trim().toLowerCase();
    return workspaceRows.filter((r) => {
      if (campaignKeyOf(r) !== selectedCampaignKey) return false;
      if (hideEmpty && r.filled === 0 && !r.lastExportedAt && !r.lastImportedAt) {
        return false;
      }
      if (bulkBp && r.bpStatus !== bulkBp) return false;
      if (bulkOnlyFilled && !(r.total > 0 && r.filled >= r.total)) return false;
      if (uploadMark === "imported" && !r.lastImportedAt) return false;
      if (uploadMark === "pending" && r.lastImportedAt) return false;
      if (!q) return true;
      return (
        r.organizationName.toLowerCase().includes(q) ||
        (r.organizationCode ?? "").toLowerCase().includes(q) ||
        String(r.zid).includes(q) ||
        String(r.eid).includes(q)
      );
    });
  }, [
    workspaceRows,
    selectedCampaignKey,
    hideEmpty,
    bulkSearch,
    bulkBp,
    bulkOnlyFilled,
    uploadMark,
  ]);

  return {
    workspaceRows,
    workspaceLoading,
    workspaceError,
    reloadWorkspace,
    campaigns,
    selectedCampaignKey,
    setSelectedCampaignKey,
    selectedCampaign,
    filteredRows,
    filters: {
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
    },
  };
}

export type WorkspaceListApi = ReturnType<typeof useWorkspacePackageList>;
