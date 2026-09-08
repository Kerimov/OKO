import { Link } from "react-router-dom";
import { Button } from "../../components/ui";
import type { PackageWorkspaceRow } from "../../types";
import { bpStatusLabel } from "../../uiLabels";
import type { ApprovalBlockers } from "../../psdApi";

type Props = {
  selectedRow: PackageWorkspaceRow;
  bpBlockers: ApprovalBlockers | null;
  canMutate: boolean;
  periodClosed: boolean;
  busy: boolean;
  checkExplanationsLink: string;
  onFillForms: () => void;
  onOpenFormsTab: () => void;
};

export function PackageOverviewPanel({
  selectedRow,
  bpBlockers,
  canMutate,
  periodClosed,
  busy,
  checkExplanationsLink,
  onFillForms,
  onOpenFormsTab,
}: Props) {
  return (
    <section className="tools-section">
      <h2>Обзор</h2>
      <ul className="package-workspace-overview">
        <li>
          Статус БП:{" "}
          <strong>
            {selectedRow.bpStatus ? bpStatusLabel(selectedRow.bpStatus) : "ещё не создан"}
          </strong>
          {selectedRow.bpIteration != null ? ` · итерация ${selectedRow.bpIteration}` : ""}
        </li>
        <li>
          Прогресс форм: {selectedRow.filled} из {selectedRow.total} ({selectedRow.percent}%)
        </li>
        <li>Период: {selectedRow.periodStatus === "closed" ? "закрыт" : "открыт"}</li>
        <li>
          Блокеры согласования:{" "}
          {bpBlockers?.blocked ? `да (${bpBlockers.missingExplanations.length})` : "нет"}
        </li>
      </ul>
      <div className="toolbar-actions">
        {selectedRow.filled < selectedRow.total && canMutate && !periodClosed && (
          <Button variant="secondary" disabled={busy} onClick={onFillForms}>
            {selectedRow.filled === 0 ? "Завести формы" : "Дозавести формы"}
          </Button>
        )}
        <Button variant="secondary" onClick={onOpenFormsTab}>
          Открыть список форм
        </Button>
        <Link to={checkExplanationsLink} className="btn btn-secondary">
          Объяснения проверок
        </Link>
      </div>
    </section>
  );
}
