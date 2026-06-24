import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { loadCatalog } from "@portal/api";
import type { InstanceSummary } from "@portal/types";
import { categoryLabel, formStatusLabel } from "@portal/utils";
import { usePackage } from "../context/PackageContext";
import { useCoordinator } from "../context/CoordinatorContext";

interface Props {
  selectedInstanceId?: string;
}

export function PackageSidebar({ selectedInstanceId }: Props) {
  const { userName, session } = usePackage();
  const { isCoordinator } = useCoordinator();
  const [instances, setInstances] = useState<InstanceSummary[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [editors, setEditors] = useState<Record<string, string[]>>({});
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [myFormsOnly, setMyFormsOnly] = useState(false);

  const restrictAssignments = session?.restrictExecutorsToAssignments ?? false;

  const reload = useCallback(() => {
    if (!window.oko) return;
    void window.oko
      .listInstances()
      .then(setInstances)
      .catch((e) => setError(e instanceof Error ? e.message : "Ошибка"));
    void window.oko.listPackageEditors().then(setEditors).catch(() => setEditors({}));
    void window.oko.getAssignments().then((a) => {
      const map: Record<string, string> = {};
      for (const item of a.items) map[item.templateId] = item.assignee;
      setAssignments(map);
    });
  }, []);

  useEffect(() => {
    void loadCatalog()
      .then((c) => setCategories(c.categories))
      .catch(() => setCategories({}));
  }, []);

  useEffect(() => {
    reload();
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [reload, selectedInstanceId]);

  const visibleInstances = useMemo(() => {
    let list = instances;
    if ((myFormsOnly || (restrictAssignments && !isCoordinator)) && userName) {
      list = list.filter((inst) => {
        const assignee = assignments[inst.templateId];
        if (!assignee) return !restrictAssignments || isCoordinator;
        return assignee.toLowerCase() === userName.toLowerCase();
      });
    }
    return list;
  }, [instances, myFormsOnly, restrictAssignments, isCoordinator, userName, assignments]);

  const grouped = useMemo(() => {
    const map = new Map<string, InstanceSummary[]>();
    for (const inst of visibleInstances) {
      const cat = inst.templateId.split("_")[0] ?? "Прочее";
      const list = map.get(cat) ?? [];
      list.push(inst);
      map.set(cat, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visibleInstances]);

  return (
    <aside className="package-sidebar" aria-label="Формы комплекта">
      <div className="package-sidebar-head">
        <Link to="/package" className="package-sidebar-title">
          Комплект
        </Link>
        <span className="muted package-sidebar-count">{visibleInstances.length} форм</span>
      </div>
      <label className="package-sidebar-filter">
        <input
          type="checkbox"
          checked={myFormsOnly}
          onChange={(e) => setMyFormsOnly(e.target.checked)}
        />
        Мои формы
      </label>
      {error && <p className="error package-sidebar-error">{error}</p>}
      <div className="package-sidebar-scroll">
        {grouped.map(([cat, items]) => (
          <section key={cat} className="package-sidebar-group">
            <h3>{categoryLabel(categories, cat)}</h3>
            <ul>
              {items.map((inst) => {
                const active = inst.instanceId === selectedInstanceId;
                const who = editors[inst.instanceId] ?? [];
                return (
                  <li key={inst.instanceId}>
                    <Link
                      to={`/form/${inst.instanceId}`}
                      className={`package-sidebar-item${active ? " active" : ""}`}
                      title={inst.displayName}
                    >
                      <span className="package-sidebar-code">{inst.templateId}</span>
                      <span className="package-sidebar-name">{inst.templateTitle}</span>
                      <span className={`badge status-${inst.status ?? "draft"}`}>
                        {formStatusLabel(inst.status)}
                      </span>
                      {who.length > 0 && (
                        <span className="package-sidebar-editors" title={who.join(", ")}>
                          {who.join(", ")}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}
