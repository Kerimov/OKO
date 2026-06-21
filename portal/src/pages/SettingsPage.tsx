import { useEffect, useState } from "react";
import { loadGlobalMeta, saveGlobalMeta } from "../storage";
import type { GlobalMeta } from "../storage";

const emptyMeta: GlobalMeta = {
  organization: "",
  enterpriseCode: "1@1",
  periodStart: "",
  periodEnd: "",
  unit: "тыс.руб.",
};

export function SettingsPage() {
  const [meta, setMeta] = useState<GlobalMeta>(emptyMeta);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadGlobalMeta().then((m) => {
      setMeta(m);
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    await saveGlobalMeta(meta);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (loading) {
    return <div className="loading">Загрузка настроек…</div>;
  }

  return (
    <div className="settings-page">
      <h1>Настройки организации</h1>
      <p className="settings-desc">
        Эти значения подставляются по умолчанию во все новые формы.
      </p>
      <div className="settings-form">
        <label>
          Код предприятия
          <input
            value={meta.enterpriseCode}
            onChange={(e) => setMeta({ ...meta, enterpriseCode: e.target.value })}
          />
        </label>
        <label>
          Организация
          <input
            value={meta.organization}
            onChange={(e) => setMeta({ ...meta, organization: e.target.value })}
            placeholder="Полное наименование"
          />
        </label>
        <label>
          Начало отчётного периода
          <input
            type="date"
            value={meta.periodStart}
            onChange={(e) => setMeta({ ...meta, periodStart: e.target.value })}
          />
        </label>
        <label>
          Конец отчётного периода
          <input
            type="date"
            value={meta.periodEnd}
            onChange={(e) => setMeta({ ...meta, periodEnd: e.target.value })}
          />
        </label>
        <label>
          Единица измерения
          <input
            value={meta.unit}
            onChange={(e) => setMeta({ ...meta, unit: e.target.value })}
          />
        </label>
        <button type="button" className="btn btn-primary" onClick={handleSave}>
          Сохранить настройки
        </button>
        {saved && <span className="saved-msg">Сохранено</span>}
      </div>
    </div>
  );
}
