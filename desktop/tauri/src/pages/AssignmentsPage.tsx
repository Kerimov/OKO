import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { loadCatalog } from "@portal/api";
import type { PackageCompleteness } from "@portal/types";
import { categoryLabel } from "@portal/utils";
import { usePackage } from "../context/PackageContext";
import { useCoordinator } from "../context/CoordinatorContext";
import { CoordinatorPinModal } from "../components/CoordinatorPinModal";

type AssignmentStatus = "assigned" | "in_progress" | "ready" | "accepted";

interface RowItem {
  templateId: string;
  title: string;
  category: string;
  instanceId?: string;
  assignee: string;
  status: AssignmentStatus;
}

const STATUS_OPTIONS: { value: AssignmentStatus; label: string }[] = [
  { value: "assigned", label: "Назначена" },
  { value: "in_progress", label: "В работе" },
  { value: "ready", label: "Готова" },
  { value: "accepted", label: "Принята" },
];

export function AssignmentsPage() {
  const { userName } = usePackage();
  const { isCoordinator, login } = useCoordinator();
  const [completeness, setCompleteness] = useState<PackageCompleteness | null>(null);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<RowItem[]>([]);
  const [knownAssignees, setKnownAssignees] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);

  const load = useCallback(async () => {
    const [c, assignments, assignees] = await Promise.all([
      window.oko.getCompleteness(),
      window.oko.getAssignments(),
      window.oko.listKnownAssignees(),
    ]);
    setCompleteness(c);
    const map = new Map(assignments.items.map((i) => [i.templateId, i]));
    setRows(
      c.items.map((item) => {
        const a = map.get(item.formId);
        return {
          templateId: item.formId,
          title: item.title,
          category: item.category,
          instanceId: item.instanceId,
          assignee: a?.assignee ?? "",
          status: (a?.status as AssignmentStatus) ?? "assigned",
        };
      })
    );
    const names = new Set([...assignees, userName]);
    for (const item of c.items) {
      const a = map.get(item.formId);
      if (a?.assignee) names.add(a.assignee);
    }
    setKnownAssignees([...names].sort((a, b) => a.localeCompare(b, "ru")));
  }, [userName]);

  useEffect(() => {
    void loadCatalog()
      .then((cat) => setCategories(cat.categories))
      .catch(() => setCategories({}));
  }, []);

  useEffect(() => {
    if (!isCoordinator) return;
    void load().catch((e) => setError(e instanceof Error ? e.message : "Ошибка загрузки"));
  }, [isCoordinator, load]);

  const grouped = useMemo(() => {
    const map = new Map<string, RowItem[]>();
    for (const row of rows) {
      const list = map.get(row.category) ?? [];
      list.push(row);
      map.set(row.category, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const updateRow = (templateId: string, patch: Partial<RowItem>) => {
    setRows((prev) => prev.map((r) => (r.templateId === templateId ? { ...r, ...patch } : r)));
  };

  const assignCategory = (category: string, assignee: string) => {
    setRows((prev) =>
      prev.map((r) => (r.category === category ? { ...r, assignee, status: "assigned" } : r))
    );
  };

  const handleSave = async () => {
    setBusy(true);
    setError("");
    try {
      await window.oko.saveAssignments(
        rows
          .filter((r) => r.assignee.trim())
          .map((r) => ({
            templateId: r.templateId,
            assignee: r.assignee.trim(),
            status: r.status,
          }))
      );
      setStatus("Назначения сохранены");
      setTimeout(() => setStatus(""), 3000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  };

  if (!isCoordinator) {
    return (
      <div className="content">
        <p>Раздел назначений доступен координатору комплекта.</p>
        <button type="button" className="primary" onClick={() => setPinOpen(true)}>
          Войти как координатор
        </button>
        <CoordinatorPinModal
          open={pinOpen}
          title="Вход координатора"
          requirePin
          onClose={() => setPinOpen(false)}
          onSubmit={login}
        />
      </div>
    );
  }

  return (
    <div className="content assignments-page">
      <div className="toolbar">
        <div>
          <h2 className="section-title">Назначения форм</h2>
          {completeness && (
            <p className="muted">
              Заведено {completeness.filled}/{completeness.total} · черновики {completeness.draft} ·
              сдано {completeness.submitted}
            </p>
          )}
        </div>
        <div className="toolbar-actions">
          <button type="button" disabled={busy} onClick={() => void handleSave()}>
            Сохранить назначения
          </button>
        </div>
      </div>

      {status && <p className="success">{status}</p>}
      {error && <p className="error">{error}</p>}

      <datalist id="assignee-list">
        {knownAssignees.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      {grouped.map(([cat, items]) => (
        <section key={cat} className="assignments-group">
          <div className="assignments-group-head">
            <h3>{categoryLabel(categories, cat)}</h3>
            <label className="bulk-assign">
              Назначить категорию
              <input
                list="assignee-list"
                placeholder="Исполнитель"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    assignCategory(cat, (e.target as HTMLInputElement).value);
                    (e.target as HTMLInputElement).value = "";
                  }
                }}
                onBlur={(e) => {
                  if (e.target.value.trim()) {
                    assignCategory(cat, e.target.value.trim());
                    e.target.value = "";
                  }
                }}
              />
            </label>
          </div>
          <div className="table-wrap tight">
            <table className="assignments-table">
              <thead>
                <tr>
                  <th>Код</th>
                  <th>Форма</th>
                  <th>Исполнитель</th>
                  <th>Статус</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.templateId}>
                    <td className="mono">{row.templateId}</td>
                    <td>{row.title}</td>
                    <td>
                      <input
                        list="assignee-list"
                        value={row.assignee}
                        onChange={(e) => updateRow(row.templateId, { assignee: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        value={row.status}
                        onChange={(e) =>
                          updateRow(row.templateId, {
                            status: e.target.value as AssignmentStatus,
                          })
                        }
                      >
                        {STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {row.instanceId ? (
                        <Link to={`/form/${row.instanceId}`}>Открыть</Link>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
