import { Link } from "react-router-dom";
import { StatusBadge } from "../../components/ui";
import type { ApprovalBlockers, BpAction, BusinessProcessDto } from "../../psdApi";
import { BP_STATUS_LABEL, formatDateTimeRu } from "../../uiLabels";
import { BP_ACTIONS } from "./packageWorkspaceModel";

type Props = {
  backend: boolean;
  bp: BusinessProcessDto | null;
  bpBlockers: ApprovalBlockers | null;
  bpActions: typeof BP_ACTIONS;
  bpBusy: boolean;
  packageChecksBusy: boolean;
  canMutate: boolean;
  checkExplanationsLink: string;
  onBpAction: (action: BpAction) => void;
  onRunPackageChecks: () => void;
};

export function PackageBpPanel({
  backend,
  bp,
  bpBlockers,
  bpActions,
  bpBusy,
  packageChecksBusy,
  canMutate,
  checkExplanationsLink,
  onBpAction,
  onRunPackageChecks,
}: Props) {
  return (
    <section className="tools-section">
      <h2>Бизнес-процесс</h2>
      {!backend && <p className="tools-hint">БП доступен только в backend-режиме.</p>}
      {backend && bp && (
        <>
          <p className="tools-hint">
            <StatusBadge status={bp.status} label={BP_STATUS_LABEL[bp.status]} />
            {" · итерация "}
            {bp.iteration}
            {bp.curatorName ? ` · куратор: ${bp.curatorName}` : ""}
            {bp.lastChangedAt
              ? ` · ${formatDateTimeRu(bp.lastChangedAt)}${
                  bp.lastChangedBy ? ` (${bp.lastChangedBy})` : ""
                }`
              : ""}
          </p>
          {bpBlockers?.blocked && (
            <p className="error">
              Блокеры:{" "}
              {bpBlockers.missingExplanations.map((m) => `#${m.ruleNumber}`).join(", ")}.{" "}
              <Link to={checkExplanationsLink}>Объяснения</Link>
            </p>
          )}
          <div className="toolbar-actions">
            {bpActions.map((a) => (
              <button
                key={a.action}
                type="button"
                className="btn btn-secondary"
                disabled={bpBusy || !canMutate}
                onClick={() => onBpAction(a.action)}
              >
                {a.label}
              </button>
            ))}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={packageChecksBusy || !canMutate}
              onClick={onRunPackageChecks}
            >
              {packageChecksBusy ? "Проверки…" : "Запустить проверки"}
            </button>
            <Link to="/bp" className="btn btn-secondary">
              Мониторинг БП
            </Link>
          </div>
        </>
      )}
      {backend && !bp && (
        <p className="tools-hint">БП не загружен для этого комплекта.</p>
      )}
    </section>
  );
}
