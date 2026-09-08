import { useEffect, useState } from "react";
import {
  dryRunMethodology,
  fetchActiveMethodology,
  listMethodologyHistory,
  rollbackMethodology,
  snapshotMethodology,
  type MethodologyRelease,
} from "../../engine/packageRules";
import { clearRashRefsCache } from "../../engine/rashRefs";
import { downloadN99Csv, listN99Changes } from "../../engine/n99Report";
import { clearRecalcCache } from "../../engine/recalcEngine";
import {
  downloadLoansNzsPackage,
  importLoansNzsPackage,
  KZS_GROUP,
  LOAN_NZS_GROUPS,
  loadEffectiveLoansNzs,
  NZS_GROUP,
  readLoansNzsPackageFile,
  type LoansNzsPackage,
} from "../../engine/refsPackage";
import { loadKontrAgents, renameKontrAgent } from "../../storage";
import type { KontrAgent } from "../../types";
import type { ReferencesTabProps } from "./ReferencesTab";

type Opts = {
  backend: boolean;
  busy: boolean;
  setBusy: (value: boolean) => void;
  onStatus: (message: string) => void;
};

/** Loans/N99/methodology state for Tools → References tab. */
export function useReferencesTab({
  backend,
  busy,
  setBusy,
  onStatus,
}: Opts): ReferencesTabProps {
  const [n99RenameId, setN99RenameId] = useState<number | "">("");
  const [n99RenameTo, setN99RenameTo] = useState("");
  const [loansPkg, setLoansPkg] = useState<LoansNzsPackage | null>(null);
  const [loansMerge, setLoansMerge] = useState<"merge" | "replace">("merge");
  const [n99Rows, setN99Rows] = useState<KontrAgent[]>([]);
  const [kontrAll, setKontrAll] = useState<KontrAgent[]>([]);
  const [methodologyVersion, setMethodologyVersion] = useState<string | null>(null);
  const [methodologyActivatedAt, setMethodologyActivatedAt] = useState<string | null>(
    null
  );
  const [methodologyHistory, setMethodologyHistory] = useState<MethodologyRelease[]>([]);
  const [methodologyChecksums, setMethodologyChecksums] = useState<
    MethodologyRelease["checksums"] | null
  >(null);

  const refreshMethodology = async () => {
    const [m, hist] = await Promise.all([
      fetchActiveMethodology(),
      listMethodologyHistory().catch(() => [] as MethodologyRelease[]),
    ]);
    setMethodologyVersion(m?.version ?? null);
    setMethodologyActivatedAt(m?.activatedAt ?? null);
    setMethodologyChecksums(m?.checksums ?? null);
    setMethodologyHistory(hist);
  };

  useEffect(() => {
    void loadEffectiveLoansNzs()
      .then(setLoansPkg)
      .catch(() => setLoansPkg(null));
    void loadKontrAgents()
      .then((agents) => {
        setKontrAll(agents);
        setN99Rows(listN99Changes(agents));
      })
      .catch(() => {
        setKontrAll([]);
        setN99Rows([]);
      });
  }, []);

  useEffect(() => {
    if (!backend) return;
    void refreshMethodology().catch(() => {
      setMethodologyVersion(null);
      setMethodologyActivatedAt(null);
      setMethodologyHistory([]);
    });
  }, [backend]);

  return {
    loans: {
      pkg: loansPkg,
      mergeMode: loansMerge,
      onMergeModeChange: setLoansMerge,
    },
    n99: {
      rows: n99Rows,
      allAgents: kontrAll,
      renameId: n99RenameId,
      renameTo: n99RenameTo,
      onRenameIdChange: setN99RenameId,
      onRenameToChange: setN99RenameTo,
    },
    backend,
    busy,
    onExportLoans: () => {
      void (async () => {
        try {
          const out = await downloadLoansNzsPackage(loansPkg ?? undefined);
          onStatus(
            `Справочники займов/НЗС выгружены: ${KZS_GROUP} ${out.counts?.[KZS_GROUP] ?? 0}, ${NZS_GROUP} ${out.counts?.[NZS_GROUP] ?? 0}`
          );
        } catch (e) {
          onStatus(e instanceof Error ? e.message : "Ошибка выгрузки справочников");
        }
      })();
    },
    onImportLoans: (file) => {
      void (async () => {
        setBusy(true);
        try {
          const incoming = await readLoansNzsPackageFile(file);
          const current = loansPkg ?? (await loadEffectiveLoansNzs());
          const { previewLoansNzsImport } = await import("../../engine/refsValidation");
          const preview = previewLoansNzsImport(current, incoming, loansMerge);
          const lines = [
            `Режим: ${loansMerge === "merge" ? "слияние" : "замена"}`,
            ...LOAN_NZS_GROUPS.map(
              (g) =>
                `${g}: ${preview.currentCounts[g]} → ${preview.resultCounts[g]} (в файле ${preview.incomingCounts[g]})`
            ),
            preview.added ? `Прирост (оценка): +${preview.added}` : null,
            preview.removed ? `Удаление (оценка): −${preview.removed}` : null,
            ...preview.warnings,
            "Применить импорт?",
          ].filter(Boolean);
          if (!confirm(lines.join("\n"))) {
            onStatus("Импорт справочников отменён");
            return;
          }
          const { package: pkg, added, total } = await importLoansNzsPackage(
            incoming,
            loansMerge
          );
          setLoansPkg(pkg);
          clearRashRefsCache();
          onStatus(
            `Справочники займов/НЗС приняты (${loansMerge === "merge" ? "слияние" : "замена"}): всего ${total}, прирост ${added}`
          );
        } catch (e) {
          onStatus(e instanceof Error ? e.message : "Ошибка импорта справочников");
        } finally {
          setBusy(false);
        }
      })();
    },
    onN99Csv: () => {
      const n = downloadN99Csv(n99Rows);
      onStatus(
        n === 0
          ? "N99: изменений нет — лист не формируем (как в Access)"
          : `N99: выгружено ${n} записей (CSV)`
      );
    },
    onRefreshN99: () => {
      void loadKontrAgents()
        .then((agents) => {
          const rows = listN99Changes(agents);
          setN99Rows(rows);
          onStatus(
            rows.length === 0
              ? "N99: изменений нет"
              : `N99: ${rows.length} записей с «Другим наименованием»`
          );
        })
        .catch((e) =>
          onStatus(e instanceof Error ? e.message : "Ошибка загрузки контрагентов")
        );
    },
    onRenameN99: () => {
      if (n99RenameId === "") return;
      void renameKontrAgent(n99RenameId, n99RenameTo.trim())
        .then(() => loadKontrAgents())
        .then((agents) => {
          setKontrAll(agents);
          setN99Rows(listN99Changes(agents));
          setN99RenameTo("");
          onStatus("Переименовано: старое имя сохранено в oldName");
        })
        .catch((e) =>
          onStatus(e instanceof Error ? e.message : "Ошибка переименования")
        );
    },
    methodology: {
      version: methodologyVersion,
      activatedAt: methodologyActivatedAt,
      checksums: methodologyChecksums,
      history: methodologyHistory,
      onSnapshot: () => {
        void (async () => {
          try {
            const m = await snapshotMethodology();
            clearRecalcCache();
            await refreshMethodology();
            onStatus(`Методология активирована: ${m.version}`);
          } catch (e) {
            onStatus(e instanceof Error ? e.message : "Ошибка снапшота методологии");
          }
        })();
      },
      onDryRun: () => {
        void (async () => {
          try {
            const r = await dryRunMethodology({});
            const changed = r.diff.filter((d) => !d.same).map((d) => d.key);
            onStatus(
              r.wouldChange
                ? `Dry-run: изменятся ${changed.join(", ") || "ключи"}`
                : "Dry-run: checksums совпадают с активным релизом"
            );
          } catch (e) {
            onStatus(e instanceof Error ? e.message : "Ошибка dry-run");
          }
        })();
      },
      onRollback: (id) => {
        void (async () => {
          try {
            const m = await rollbackMethodology(id);
            clearRecalcCache();
            await refreshMethodology();
            onStatus(`Откат методологии: ${m.version}`);
          } catch (e) {
            onStatus(e instanceof Error ? e.message : "Ошибка отката");
          }
        })();
      },
    },
  };
}
