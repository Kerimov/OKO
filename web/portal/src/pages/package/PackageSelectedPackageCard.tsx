import { Link } from "react-router-dom";
import { Button, StatusBadge, StatusBanner } from "../../components/ui";
import type { ApprovalBlockers } from "../../psdApi";
import type { PackageWorkspaceRow } from "../../types";
import { bpStatusLabel, formatDateTimeRu, packageKindLabel } from "../../uiLabels";
import { formatPeriod } from "../../utils";
import { ProgressMeter } from "./ProgressMeter";

export type PrimaryCta =
  | { kind: "create"; label: string }
  | { kind: "bp"; action: string; label: string }
  | { kind: "forms-tab"; label: string };

type Props = {
  selectedRow: PackageWorkspaceRow;
  detailLoading: boolean;
  bpBlockers: ApprovalBlockers | null;
  primaryCta: PrimaryCta | null;
  canMutate: boolean;
  busy: boolean;
  bpBusy: boolean;
  packageChecksBusy: boolean;
  backend: boolean;
  formsLinkLabel: string;
  checkExplanationsLink: string;
  onBackToPeriod: () => void;
  onPrimaryCta: () => void;
  onRunPackageChecks: () => void;
};

export function PackageSelectedPackageCard({
  selectedRow,
  detailLoading,
  bpBlockers,
  primaryCta,
  canMutate,
  busy,
  bpBusy,
  packageChecksBusy,
  backend,
  formsLinkLabel,
  checkExplanationsLink,
  onBackToPeriod,
  onPrimaryCta,
  onRunPackageChecks,
}: Props) {
  return (
    <section className="tools-section package-workspace-card">
      <div className="package-workspace-card-head">
        <div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ marginBottom: 8 }}
            onClick={onBackToPeriod}
          >
            ← К периоду
          </button>
          <h2>
            {selectedRow.organizationName}
            {" · "}
            {selectedRow.periodName}
            {" · "}
            {packageKindLabel(selectedRow.packageKind)}
          </h2>
          <p className="tools-hint package-workspace-card-meta">
            {formatPeriod(selectedRow.periodStart ?? "", selectedRow.periodEnd ?? "")}
            {" · период "}
            <strong>{selectedRow.periodStatus === "closed" ? "закрыт" : "открыт"}</strong>
            {selectedRow.curatorName ? ` · куратор: ${selectedRow.curatorName}` : ""}
            {selectedRow.bpLastChangedAt
              ? ` · изменён ${formatDateTimeRu(selectedRow.bpLastChangedAt)}`
              : ""}
          </p>
        </div>
        {selectedRow.bpStatus && (
          <StatusBadge
            status={selectedRow.bpStatus}
            label={bpStatusLabel(selectedRow.bpStatus)}
          />
        )}
      </div>

      <div className="package-workspace-card-progress">
        <ProgressMeter percent={selectedRow.percent} />
      </div>
      <p className="tools-hint">
        Формы:{" "}
        <strong>
          {selectedRow.filled}/{selectedRow.total}
        </strong>
        {" · черновики "}
        <strong>{selectedRow.draft}</strong>
        {" · сдано "}
        <strong>{selectedRow.submitted}</strong>
        {detailLoading ? " · обновление…" : ""}
      </p>

      {bpBlockers?.blocked && (
        <StatusBanner tone="error">
          Согласование заблокировано — нет объяснений:{" "}
          {bpBlockers.missingExplanations.map((m) => `#${m.ruleNumber}`).join(", ")}.{" "}
          <Link to={checkExplanationsLink}>Объяснения проверок</Link>
        </StatusBanner>
      )}

      <div className="toolbar-actions">
        {primaryCta && (
          <Button
            disabled={busy || bpBusy || (primaryCta.kind !== "forms-tab" && !canMutate)}
            onClick={onPrimaryCta}
          >
            {busy || bpBusy ? "…" : primaryCta.label}
          </Button>
        )}
        <Link to="/my" className="btn btn-secondary">
          {formsLinkLabel}
        </Link>
        {backend && (
          <Button
            variant="secondary"
            disabled={packageChecksBusy || !canMutate}
            onClick={onRunPackageChecks}
          >
            {packageChecksBusy ? "Проверки…" : "Запустить проверки"}
          </Button>
        )}
        <Link to="/bp" className="btn btn-secondary">
          Мониторинг БП
        </Link>
      </div>
    </section>
  );
}
