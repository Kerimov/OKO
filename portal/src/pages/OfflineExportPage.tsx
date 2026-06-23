import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { downloadReportPackage } from "../engine/packageExport";
import { loadWorkPackageInstances } from "../engine/workPackageInstances";
import { listOrganizations, listPeriods } from "../packagesApi";
import { isOfflineKitMode } from "../offlineMode";
import type { OkoFormInstance } from "../types";

export function OfflineExportPage() {
  const [instances, setInstances] = useState<OkoFormInstance[]>([]);
  const [orgName, setOrgName] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [status, setStatus] = useState("");
  const offline = isOfflineKitMode();

  useEffect(() => {
    (async () => {
      const { instances, zid, eid } = await loadWorkPackageInstances();
      setInstances(instances);
      if (zid != null && eid != null) {
        const orgs = await listOrganizations();
        const org = orgs.find((o) => Number(o.zid) === zid);
        setOrgName(org?.name ?? "—");
        const periods = await listPeriods(zid);
        const period = periods.find((p) => Number(p.eid) === eid);
        setPeriodLabel(period?.name ?? "—");
      } else {
        setOrgName("—");
        setPeriodLabel("—");
      }
    })();
  }, []);

  const handleExport = () => {
    if (instances.length === 0) {
      setStatus("Нет форм для экспорта. Заведите комплект или создайте формы из каталога.");
      return;
    }
    downloadReportPackage(instances);
    setStatus(`Файл сохранён: ${instances.length} форм. Отправьте его в центральный офис.`);
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1>{offline ? "Отправить комплект в ЦО" : "Экспорт комплекта"}</h1>
        <p className="page-lead">
          Сохраните заполненные формы в один JSON-файл и передайте его в центральный офис
          (по почте, SharePoint или другим согласованным каналом).
        </p>
      </header>

      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2>Текущий комплект</h2>
        <dl className="meta-dl">
          <dt>Организация</dt>
          <dd>{orgName}</dd>
          <dt>Период</dt>
          <dd>{periodLabel}</dd>
          <dt>Форм в комплекте</dt>
          <dd>{instances.length}</dd>
        </dl>
      </section>

      <div className="toolbar-actions" style={{ marginBottom: "1rem" }}>
        <button type="button" className="btn btn-primary" onClick={handleExport}>
          Сохранить комплект JSON ({instances.length})
        </button>
        <Link to="/my" className="btn btn-secondary">
          Мои формы
        </Link>
      </div>

      {status && <p className="status-line">{status}</p>}

      {offline && (
        <section className="card">
          <h2>Инструкция</h2>
          <ol className="instructions-list">
            <li>Заполните формы в разделе <strong>Мои формы</strong>.</li>
            <li>Нажмите <strong>Сохранить комплект JSON</strong> — файл появится в папке «Загрузки».</li>
            <li>Отправьте файл ответственному в центральном офисе.</li>
            <li>ЦО загрузит комплект через <strong>Сводка и импорт → Импорт комплекта</strong>.</li>
          </ol>
        </section>
      )}
    </div>
  );
}
