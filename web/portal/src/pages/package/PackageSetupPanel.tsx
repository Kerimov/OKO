import { Link } from "react-router-dom";
import type { Organization, PackageWorkspaceRow } from "../../types";

type Props = {
  selectedRow: PackageWorkspaceRow | null;
  canMutate: boolean;
  periodClosed: boolean;
  busy: boolean;
  zid: number | "";
  eid: number | "";
  childOrgs: Organization[];
  childOrgCount: number;
  canDeletePackage: boolean;
  onDistribute: () => void;
  onDeletePackage: () => void;
};

export function PackageSetupPanel({
  selectedRow,
  canMutate,
  periodClosed,
  busy,
  zid,
  eid,
  childOrgs,
  childOrgCount,
  canDeletePackage,
  onDistribute,
  onDeletePackage,
}: Props) {
  return (
    <section className="tools-section">
      <h2>Настройка</h2>
      {selectedRow && (
        <div className="toolbar-actions" style={{ marginBottom: 16 }}>
          {canMutate && !periodClosed && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || typeof zid !== "number" || typeof eid !== "number"}
              onClick={onDistribute}
            >
              Раздать дочкам
              {childOrgs.length || childOrgCount
                ? ` (${childOrgs.length || childOrgCount})`
                : ""}
            </button>
          )}
          {canDeletePackage && canMutate && (
            <button
              type="button"
              className="btn btn-danger-outline"
              disabled={busy}
              onClick={onDeletePackage}
            >
              Удалить комплект
            </button>
          )}
        </div>
      )}

      {canMutate && (
        <>
          <h3>Организации</h3>
          <p className="tools-hint">
            Создание и карточки организаций — в справочнике{" "}
            <Link to="/admin/refs?kind=Организации">Справочники → Организации</Link>.
          </p>
          <p className="tools-hint">
            Кампания выбирается в списке слева. Комплекты и формы создаются внутри
            периметра кампании, закрытие — на карточке кампании.
          </p>
        </>
      )}
    </section>
  );
}
