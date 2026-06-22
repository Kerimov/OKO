import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { FormInstanceStatus, InstanceSummary } from "../types";
import {
  deleteInstance,
  importInstanceFile,
  listInstances,
} from "../storage";
import { formatPeriod, formStatusLabel } from "../utils";

export function MyFormsPage() {
  const navigate = useNavigate();
  const [instances, setInstances] = useState<InstanceSummary[]>([]);
  const [search, setSearch] = useState("");
  const [filterTemplate, setFilterTemplate] = useState("all");
  const [filterStatus, setFilterStatus] = useState<"all" | FormInstanceStatus>("all");

  const refresh = async () => setInstances(await listInstances());

  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return instances.filter((inst) => {
      if (filterTemplate !== "all" && inst.templateId !== filterTemplate) {
        return false;
      }
      if (filterStatus !== "all" && (inst.status ?? "draft") !== filterStatus) {
        return false;
      }
      if (!q) return true;
      return (
        inst.displayName.toLowerCase().includes(q) ||
        inst.templateId.toLowerCase().includes(q) ||
        inst.templateTitle.toLowerCase().includes(q) ||
        inst.organization.toLowerCase().includes(q)
      );
    });
  }, [instances, search, filterTemplate, filterStatus]);

  const templateOptions = useMemo(() => {
    const ids = new Set(instances.map((i) => i.templateId));
    return Array.from(ids).sort();
  }, [instances]);

  const handleDelete = (inst: InstanceSummary) => {
    if (
      !confirm(
        `Удалить форму «${inst.displayName}»?\nДанные будут удалены безвозвратно.`
      )
    ) {
      return;
    }
    deleteInstance(inst.instanceId).then(refresh);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const inst = await importInstanceFile(file);
      refresh();
      navigate(`/my/${inst.instanceId}`);
    } catch {
      alert("Не удалось импортировать файл");
    }
    e.target.value = "";
  };

  return (
    <div className="my-forms-page">
      <section className="hero">
        <h1>Мои формы ОКО</h1>
        <p>
          Здесь хранятся отдельные заполненные экземпляры форм. Создайте новую
          форму в <Link to="/">каталоге шаблонов</Link> или откройте{" "}
          <Link to="/tools">администрирование</Link> для проверки и сальdo.
        </p>
        <div className="stats">
          <span className="stat">{instances.length} сохранённых форм</span>
        </div>
      </section>

      <div className="filters my-forms-filters">
        <input
          type="search"
          placeholder="Поиск по названию, коду, организации…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search-input"
        />
        <select
          value={filterTemplate}
          onChange={(e) => setFilterTemplate(e.target.value)}
          className="category-select"
        >
          <option value="all">Все типы форм</option>
          {templateOptions.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as "all" | FormInstanceStatus)}
          className="category-select"
        >
          <option value="all">Все статусы</option>
          <option value="draft">Черновики</option>
          <option value="submitted">Сдано</option>
        </select>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            const input = document.getElementById("import-instance") as HTMLInputElement;
            input?.click();
          }}
        >
          Импорт JSON
        </button>
        <input
          id="import-instance"
          type="file"
          accept=".json"
          hidden
          onChange={handleImport}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          {instances.length === 0 ? (
            <>
              <p>У вас пока нет сохранённых форм.</p>
              <Link to="/" className="btn btn-primary">
                Перейти в каталог и создать форму
              </Link>
            </>
          ) : (
            <p>Ничего не найдено по запросу</p>
          )}
        </div>
      ) : (
        <div className="instance-list">
          {filtered.map((inst) => (
            <article key={inst.instanceId} className="instance-card">
              <div className="instance-card-body">
                <Link
                  to={`/my/${inst.instanceId}`}
                  className="instance-card-title"
                >
                  {inst.displayName}
                </Link>
                <div className="instance-card-meta">
                  <span className="form-card-id">{inst.templateId}</span>
                  <span>{inst.templateTitle}</span>
                  <span className={`status-badge ${inst.status ?? "draft"}`}>
                    {formStatusLabel(inst.status)}
                  </span>
                </div>
                {inst.organization && (
                  <p className="instance-org">{inst.organization}</p>
                )}
                <p className="instance-period">
                  {formatPeriod(inst.periodStart, inst.periodEnd)}
                </p>
                <p className="instance-dates">
                  Создано:{" "}
                  {new Date(inst.createdAt).toLocaleString("ru-RU")}
                  {" · "}
                  Изменено:{" "}
                  {new Date(inst.updatedAt).toLocaleString("ru-RU")}
                </p>
              </div>
              <div className="instance-card-actions">
                <Link
                  to={`/my/${inst.instanceId}`}
                  className="btn btn-primary btn-sm"
                >
                  Открыть
                </Link>
                <button
                  type="button"
                  className="btn btn-danger-outline btn-sm"
                  onClick={() => handleDelete(inst)}
                >
                  Удалить
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
