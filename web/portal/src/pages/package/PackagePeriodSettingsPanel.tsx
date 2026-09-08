import { Button } from "../../components/ui";
import type { Organization } from "../../types";
import { packageKindLabel, orgOptionLabel } from "../../uiLabels";
import { formatPeriod } from "../../utils";
import type { PeriodCampaign } from "./packageWorkspaceModel";

type Props = {
  campaign: PeriodCampaign;
  periodLocked: boolean;
  admin: boolean;
  canMutate: boolean;
  busy: boolean;
  orgsMissingFromCampaign: Organization[];
  addOrgSearch: string;
  addOrgZids: number[];
  onAddOrgSearchChange: (value: string) => void;
  onAddOrgZidsChange: (value: number[] | ((prev: number[]) => number[])) => void;
  onAddOrgsToPeriod: () => void;
  onCloseCampaign: (opts?: { force?: boolean }) => void;
  onReopenCampaign: () => void;
  onBackToPackages: () => void;
};

export function PackagePeriodSettingsPanel({
  campaign,
  periodLocked,
  admin,
  canMutate,
  busy,
  orgsMissingFromCampaign,
  addOrgSearch,
  addOrgZids,
  onAddOrgSearchChange,
  onAddOrgZidsChange,
  onAddOrgsToPeriod,
  onCloseCampaign,
  onReopenCampaign,
  onBackToPackages,
}: Props) {
  return (
    <section className="tools-section package-workspace-card">
      <h2>
        Настройки кампании · {campaign.periodName} · {packageKindLabel(campaign.packageKind)}
      </h2>
      <p className="tools-hint">
        {campaign.periodStart && campaign.periodEnd
          ? formatPeriod(campaign.periodStart, campaign.periodEnd)
          : ""}
        {" · статус "}
        <strong>
          {campaign.status === "closed"
            ? "закрыт"
            : campaign.status === "mixed"
              ? "частично закрыт"
              : "открыт"}
        </strong>
      </p>

      <ul className="package-workspace-overview">
        <li>
          Организаций: <strong>{campaign.orgCount}</strong>
        </li>
        <li>
          Открыто: <strong>{campaign.openCount}</strong>
          {" · закрыто: "}
          <strong>{campaign.closedCount}</strong>
        </li>
        <li>
          Готовы к закрытию (БП завершён): <strong>{campaign.closableCount}</strong>
        </li>
        <li>
          Ещё нельзя закрыть (БП не завершён): <strong>{campaign.blockedCloseCount}</strong>
        </li>
        <li>
          Без форм: <strong>{campaign.withoutForms}</strong>
        </li>
      </ul>

      {periodLocked ? (
        <p className="tools-hint" style={{ marginBottom: 16 }}>
          Кампания закрыта — нельзя добавлять организации и заводить формы. Можно только
          переоткрыть кампанию.
        </p>
      ) : null}

      <h3>Добавить организации</h3>
      {periodLocked ? (
        <p className="tools-hint">Справочник недоступен для дополнения: период закрыт.</p>
      ) : (
        <>
          <p className="tools-hint">
            Та же операция доступна на экране «Периметр кампании». Здесь она оставлена
            как настройка состава периода.
          </p>
          {orgsMissingFromCampaign.length === 0 ? (
            <p className="tools-hint">
              {addOrgSearch.trim()
                ? "По поиску ничего не найдено среди организаций вне периода."
                : "Все организации справочника уже в периоде."}
            </p>
          ) : (
            <>
              <label style={{ display: "block", marginBottom: 8 }}>
                Поиск
                <input
                  type="search"
                  className="search-input"
                  value={addOrgSearch}
                  onChange={(e) => onAddOrgSearchChange(e.target.value)}
                  placeholder="Название, код, ZID…"
                  style={{ display: "block", marginTop: 4, minWidth: 240 }}
                />
              </label>
              <div className="toolbar-actions" style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onAddOrgZidsChange(orgsMissingFromCampaign.map((o) => o.zid))}
                >
                  Выбрать все ({orgsMissingFromCampaign.length})
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onAddOrgZidsChange([])}
                >
                  Снять выбор
                </button>
                <span className="tools-hint">Выбрано: {addOrgZids.length}</span>
              </div>
              <div className="aggr-list package-constructor-org-list">
                {orgsMissingFromCampaign.map((o) => (
                  <label key={o.zid} className="package-constructor-check-row">
                    <input
                      type="checkbox"
                      checked={addOrgZids.includes(o.zid)}
                      onChange={() => {
                        onAddOrgZidsChange((prev) =>
                          prev.includes(o.zid)
                            ? prev.filter((z) => z !== o.zid)
                            : [...prev, o.zid]
                        );
                      }}
                    />
                    <span>{orgOptionLabel(o)}</span>
                  </label>
                ))}
              </div>
              <div className="toolbar-actions" style={{ marginTop: 12 }}>
                <Button disabled={busy || addOrgZids.length === 0} onClick={onAddOrgsToPeriod}>
                  Добавить в кампанию
                  {addOrgZids.length ? ` (${addOrgZids.length})` : ""}
                </Button>
              </div>
            </>
          )}
        </>
      )}

      <h3>Закрытие и переоткрытие</h3>
      <p className="tools-hint">
        Обычное закрытие доступно для комплектов с завершённым бизнес-процессом. После
        закрытия формы нельзя редактировать.
      </p>
      <div className="toolbar-actions">
        {canMutate && (
          <Button
            disabled={busy || campaign.closableCount === 0}
            onClick={() => onCloseCampaign()}
          >
            Закрыть период
            {campaign.closableCount > 0 ? ` (${campaign.closableCount})` : ""}
          </Button>
        )}
        {canMutate && admin && campaign.openCount > 0 && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => onCloseCampaign({ force: true })}
          >
            Закрыть принудительно
            {campaign.openCount > 0 ? ` (${campaign.openCount})` : ""}
          </Button>
        )}
        {canMutate && campaign.closedCount > 0 && (
          <Button variant="secondary" disabled={busy} onClick={onReopenCampaign}>
            Переоткрыть период
            {campaign.closedCount > 0 ? ` (${campaign.closedCount})` : ""}
          </Button>
        )}
        <Button variant="secondary" onClick={onBackToPackages}>
          К комплектам периода
        </Button>
      </div>
      {canMutate && campaign.closableCount === 0 && campaign.openCount > 0 ? (
        <p className="tools-hint" style={{ marginTop: 12 }}>
          Сейчас закрыть обычным способом нельзя: ни у одного комплекта БП не в статусе
          «Завершён».
          {admin
            ? " Администратор может закрыть принудительно."
            : " Завершите бизнес-процесс по организациям или обратитесь к администратору."}
        </p>
      ) : null}
    </section>
  );
}
