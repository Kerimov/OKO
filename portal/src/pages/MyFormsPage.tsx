import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  formsListTitle,
  instanceMatchesPackage,
  isAdminFormsView,
  isOrgFormsUser,
} from "../formsListLabels";
import { loadWorkContext, listOrganizations, listPeriods } from "../packagesApi";
import type { FormInstanceStatus, InstanceSummary, Organization, ReportingPeriod } from "../types";
import {
  deleteInstance,
  importInstanceFile,
  listInstances,
} from "../storage";
import { useAuth } from "../useAuth";
import { formatPeriod, formStatusLabel } from "../utils";

type PackageGroup = {
  key: string;
  zid: number | null;
  eid: number | null;
  orgName: string;
  periodName: string;
  periodStart: string;
  periodEnd: string;
  items: InstanceSummary[];
};

type OrgGroup = {
  key: string;
  zid: number | null;
  orgName: string;
  periods: PackageGroup[];
  totalForms: number;
};

function buildOrgGroups(packageGroups: PackageGroup[]): OrgGroup[] {
  const map = new Map<string, OrgGroup>();
  for (const group of packageGroups) {
    const key = String(group.zid ?? "x");
    let org = map.get(key);
    if (!org) {
      org = {
        key,
        zid: group.zid,
        orgName: group.orgName,
        periods: [],
        totalForms: 0,
      };
      map.set(key, org);
    }
    org.periods.push(group);
    org.totalForms += group.items.length;
  }
  return Array.from(map.values()).sort((a, b) => (a.zid ?? 0) - (b.zid ?? 0));
}

function buildPackageGroups(
  items: InstanceSummary[],
  orgs: Organization[],
  periodsByZid: Map<number, ReportingPeriod[]>
): PackageGroup[] {
  const map = new Map<string, PackageGroup>();
  for (const inst of items) {
    const zid = inst.zid ?? null;
    const eid = inst.eid ?? null;
    const key = `${zid ?? "x"}:${eid ?? "x"}`;
    let group = map.get(key);
    if (!group) {
      const org = zid != null ? orgs.find((o) => o.zid === zid) : undefined;
      const periods = zid != null ? periodsByZid.get(zid) ?? [] : [];
      const period = eid != null ? periods.find((p) => p.eid === eid) : undefined;
      group = {
        key,
        zid,
        eid,
        orgName: org?.name ?? (inst.organization || "Без организации"),
        periodName: period?.name ?? (formatPeriod(inst.periodStart, inst.periodEnd) || "Без периода"),
        periodStart: period?.periodStart ?? inst.periodStart,
        periodEnd: period?.periodEnd ?? inst.periodEnd,
        items: [],
      };
      map.set(key, group);
    }
    group.items.push(inst);
  }
  return Array.from(map.values()).sort((a, b) => {
    const az = a.zid ?? 0;
    const bz = b.zid ?? 0;
    if (az !== bz) return az - bz;
    return (a.eid ?? 0) - (b.eid ?? 0);
  });
}

function InstanceCard({
  inst,
  checked,
  deleting,
  showPackageIds,
  hideOrgLine,
  compact,
  onToggle,
  onDelete,
}: {
  inst: InstanceSummary;
  checked: boolean;
  deleting: boolean;
  showPackageIds: boolean;
  hideOrgLine?: boolean;
  compact?: boolean;
  onToggle: (id: string, checked: boolean) => void;
  onDelete: (inst: InstanceSummary) => void;
}) {
  return (
    <article
      className={`instance-card${checked ? " instance-card-selected" : ""}`}
    >
      <label className="instance-card-check">
        <input
          type="checkbox"
          checked={checked}
          disabled={deleting}
          onChange={(e) => onToggle(inst.instanceId, e.target.checked)}
          aria-label={`Выбрать «${inst.displayName}»`}
        />
      </label>
      <div className="instance-card-body">
        <Link to={`/my/${inst.instanceId}`} className="instance-card-title">
          {inst.displayName}
        </Link>
        <div className="instance-card-meta">
          <span className="form-card-id">{inst.templateId}</span>
          <span className={`status-badge ${inst.status ?? "draft"}`}>
            {formStatusLabel(inst.status)}
          </span>
          {showPackageIds && (inst.zid != null || inst.eid != null) && (
            <span className="package-id-badge">
              ZID={inst.zid ?? "—"}, EID={inst.eid ?? "—"}
            </span>
          )}
        </div>
        <p className="instance-card-template-title">{inst.templateTitle}</p>
        {inst.organization && !hideOrgLine && !compact && (
          <p className="instance-org">{inst.organization}</p>
        )}
        {!compact && (
          <p className="instance-period">
            {formatPeriod(inst.periodStart, inst.periodEnd)}
          </p>
        )}
        <p className="instance-dates">
          Создано: {new Date(inst.createdAt).toLocaleString("ru-RU")}
          {" · "}
          Изменено: {new Date(inst.updatedAt).toLocaleString("ru-RU")}
        </p>
      </div>
      <div className="instance-card-actions">
        <Link to={`/my/${inst.instanceId}`} className="btn btn-primary btn-sm">
          Открыть
        </Link>
        <button
          type="button"
          className="btn btn-danger-outline btn-sm"
          disabled={deleting}
          onClick={() => onDelete(inst)}
        >
          Удалить
        </button>
      </div>
    </article>
  );
}

export function MyFormsPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const adminView = isAdminFormsView(auth);
  const orgUser = isOrgFormsUser(auth);
  const orgZid = orgUser ? auth.user?.zid ?? null : null;
  const pageTitle = formsListTitle(auth);
  const hideOrgOnCards = orgUser;

  const [instances, setInstances] = useState<InstanceSummary[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [periods, setPeriods] = useState<ReportingPeriod[]>([]);
  const [filterZid, setFilterZid] = useState<number | "">("");
  const [filterEid, setFilterEid] = useState<number | "">("");
  const [search, setSearch] = useState("");
  const [filterTemplate, setFilterTemplate] = useState("all");
  const [filterStatus, setFilterStatus] = useState<"all" | FormInstanceStatus>("all");
  const [groupByPackage, setGroupByPackage] = useState(true);
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(() => new Set());
  const [expandedPeriods, setExpandedPeriods] = useState<Set<string>>(() => new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const zid =
        adminView && filterZid !== ""
          ? filterZid
          : orgZid ?? (filterZid !== "" ? filterZid : undefined);
      const eid = filterEid !== "" ? filterEid : undefined;

      let list: InstanceSummary[];
      if (zid != null && eid != null) {
        list = await listInstances({ zid, eid });
      } else if (zid != null) {
        list = await listInstances({ zid });
      } else {
        list = await listInstances();
      }
      setInstances(list);
      setSelectedIds((prev) => {
        const ids = new Set(list.map((i) => i.instanceId));
        const next = new Set<string>();
        for (const id of prev) {
          if (ids.has(id)) next.add(id);
        }
        return next;
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
      if (adminView) {
        setOrgs(await listOrganizations());
        return;
      }

      if (orgUser && orgZid != null) {
        setFilterZid(orgZid);
        const o = await listOrganizations();
        setOrgs(o.filter((x) => x.zid === orgZid));
        setPeriods(await listPeriods(orgZid));
        return;
      }

      const o = await listOrganizations();
      setOrgs(o);
      const ctx = await loadWorkContext();
      const zid = ctx.zid ?? o[0]?.zid ?? null;
      if (zid != null) {
        setFilterZid(zid);
        setPeriods(await listPeriods(zid));
      }
    })();
  }, [adminView, orgUser, orgZid]);

  useEffect(() => {
    if (!adminView || filterZid === "") return;
    void listPeriods(filterZid).then(setPeriods);
  }, [adminView, filterZid]);

  useEffect(() => {
    void refresh();
  }, [filterZid, filterEid, adminView, orgZid]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return instances.filter((inst) => {
      if (!instanceMatchesPackage(inst, filterZid, filterEid)) return false;
      if (filterTemplate !== "all" && inst.templateId !== filterTemplate) return false;
      if (filterStatus !== "all" && (inst.status ?? "draft") !== filterStatus) return false;
      if (!q) return true;
      return (
        inst.displayName.toLowerCase().includes(q) ||
        inst.templateId.toLowerCase().includes(q) ||
        inst.templateTitle.toLowerCase().includes(q) ||
        inst.organization.toLowerCase().includes(q)
      );
    });
  }, [instances, search, filterTemplate, filterStatus, filterZid, filterEid]);

  const periodsByZid = useMemo(() => {
    const map = new Map<number, ReportingPeriod[]>();
    if (filterZid !== "") {
      map.set(filterZid, periods);
    }
    const zids = new Set(filtered.map((i) => i.zid).filter((z): z is number => z != null));
    for (const zid of zids) {
      if (!map.has(zid)) map.set(zid, periods.filter((p) => p.zid === zid));
    }
    return map;
  }, [filtered, filterZid, periods]);

  const packageGroups = useMemo(() => {
    if (!groupByPackage) return null;
    return buildPackageGroups(filtered, orgs, periodsByZid);
  }, [groupByPackage, filtered, orgs, periodsByZid]);

  const orgGroups = useMemo(() => {
    if (!packageGroups) return null;
    return adminView ? buildOrgGroups(packageGroups) : null;
  }, [packageGroups, adminView]);

  const filteredIds = useMemo(
    () => filtered.map((inst) => inst.instanceId),
    [filtered]
  );

  const selectedCount = selectedIds.size;
  const allFilteredSelected =
    filtered.length > 0 && filteredIds.every((id) => selectedIds.has(id));
  const someFilteredSelected =
    filteredIds.some((id) => selectedIds.has(id)) && !allFilteredSelected;

  const templateOptions = useMemo(() => {
    const ids = new Set(instances.map((i) => i.templateId));
    return Array.from(ids).sort();
  }, [instances]);

  const selectedOrg = useMemo(() => {
    if (orgUser && auth.user?.organizationName) {
      return orgs.find((o) => o.zid === orgZid) ?? {
        zid: orgZid ?? 0,
        name: auth.user.organizationName,
        code: null,
        parentZid: null,
      };
    }
    return filterZid !== "" ? orgs.find((o) => o.zid === filterZid) : null;
  }, [orgUser, orgZid, orgs, filterZid, auth.user?.organizationName]);

  const selectedPeriod = filterEid !== "" ? periods.find((p) => p.eid === filterEid) : null;

  const toggleOne = (instanceId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(instanceId);
      else next.delete(instanceId);
      return next;
    });
  };

  const toggleAllFiltered = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of filteredIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const deleteInstances = async (ids: string[], label: string) => {
    if (ids.length === 0) return;
    if (
      !confirm(
        ids.length === 1
          ? `Удалить форму «${label}»?\nДанные будут удалены безвозвратно.`
          : `Удалить ${ids.length} форм?\nДанные будут удалены безвозвратно.`
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      await Promise.all(ids.map((id) => deleteInstance(id)));
      await refresh();
    } catch {
      alert("Не удалось удалить одну или несколько форм");
      await refresh();
    } finally {
      setDeleting(false);
    }
  };

  const handleDelete = (inst: InstanceSummary) => {
    deleteInstances([inst.instanceId], inst.displayName);
  };

  const handleDeleteSelected = () => {
    deleteInstances(Array.from(selectedIds), "");
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

  const handleZidChange = (value: string) => {
    const next = value === "" ? "" : Number(value);
    setFilterZid(next);
    setFilterEid("");
  };

  const toggleOrg = (key: string) => {
    setExpandedOrgs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const togglePeriod = (key: string) => {
    setExpandedPeriods((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderPeriodGroup = (group: PackageGroup, nested = false) => {
    const expanded = expandedPeriods.has(group.key);
    const periodLabel = formatPeriod(group.periodStart, group.periodEnd);
    const periodTitle =
      !periodLabel || group.periodName === periodLabel || group.periodName === "Без периода"
        ? group.periodName || periodLabel
        : `${group.periodName} (${periodLabel})`;

    return (
      <section
        key={group.key}
        className={`forms-package-group${nested ? " forms-package-group-nested" : ""}`}
      >
        <header className="forms-package-group-header forms-tree-header">
          <button
            type="button"
            className="forms-tree-toggle"
            onClick={() => togglePeriod(group.key)}
            aria-expanded={expanded}
          >
            <span className="forms-tree-chevron" aria-hidden>
              {expanded ? "▾" : "▸"}
            </span>
            <span className="forms-package-group-title">{periodTitle}</span>
            <span className="forms-package-group-meta">
              {nested && group.eid != null ? (
                <>EID={group.eid} · </>
              ) : (
                group.zid != null && (
                  <>
                    ZID={group.zid}
                    {group.eid != null ? `, EID=${group.eid}` : ""}
                    {" · "}
                  </>
                )
              )}
              {group.items.length} форм
            </span>
          </button>
          {group.zid != null && group.eid != null && (
            <Link
              to={`/package?zid=${group.zid}&eid=${group.eid}`}
              className="forms-package-group-link"
              onClick={(e) => e.stopPropagation()}
            >
              Открыть комплект
            </Link>
          )}
        </header>
        {expanded && (
          <div className="instance-list">
            {group.items.map((inst) => (
              <InstanceCard
                key={inst.instanceId}
                inst={inst}
                checked={selectedIds.has(inst.instanceId)}
                deleting={deleting}
                showPackageIds={adminView}
                hideOrgLine={hideOrgOnCards}
                compact={nested || groupByPackage}
                onToggle={toggleOne}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </section>
    );
  };

  const renderList = () => {
    if (orgGroups && orgGroups.length > 0) {
      return orgGroups.map((org) => {
        const orgExpanded = expandedOrgs.has(org.key);
        return (
          <section key={org.key} className="forms-org-group">
            <header className="forms-org-group-header forms-tree-header">
              <button
                type="button"
                className="forms-tree-toggle"
                onClick={() => toggleOrg(org.key)}
                aria-expanded={orgExpanded}
              >
                <span className="forms-tree-chevron" aria-hidden>
                  {orgExpanded ? "▾" : "▸"}
                </span>
                <span className="forms-org-group-title">{org.orgName}</span>
                <span className="forms-org-group-meta">
                  {org.zid != null && <>ZID={org.zid} · </>}
                  {org.periods.length}{" "}
                  {org.periods.length === 1 ? "период" : org.periods.length < 5 ? "периода" : "периодов"}
                  {" · "}
                  {org.totalForms} форм
                </span>
              </button>
            </header>
            {orgExpanded && (
              <div className="forms-org-periods">
                {org.periods.map((group) => renderPeriodGroup(group, true))}
              </div>
            )}
          </section>
        );
      });
    }

    if (packageGroups && packageGroups.length > 0) {
      return packageGroups.map((group) => renderPeriodGroup(group));
    }

    return (
      <div className="instance-list">
        {filtered.map((inst) => (
          <InstanceCard
            key={inst.instanceId}
            inst={inst}
            checked={selectedIds.has(inst.instanceId)}
            deleting={deleting}
            showPackageIds={adminView}
            hideOrgLine={hideOrgOnCards}
            onToggle={toggleOne}
            onDelete={handleDelete}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="my-forms-page">
      <section className="hero">
        <h1>{pageTitle}</h1>
        {adminView ? (
          <p>
            Все экземпляры форм по организациям и отчётным периодам. Рабочий контекст
            комплекта задаётся в <Link to="/package">Комплект</Link>; здесь можно просмотреть
            и отфильтровать формы по всей системе. Для проверок и выгрузки —{" "}
            <Link to="/tools">Сводка и импорт</Link>.
          </p>
        ) : orgUser ? (
          <p>
            Формы вашей организации по отчётным периодам. Выберите период или просмотрите
            комплекты сгруппированно. Завести полный набор форм — в разделе{" "}
            <Link to="/package">Комплект</Link>.
          </p>
        ) : (
          <p>
            Заполненные формы по отчётным периодам. Выберите период в фильтре или сгруппируйте
            список по комплектам. Новую форму можно создать в{" "}
            <Link to="/catalog">каталоге шаблонов</Link>
            {" "}
            или завести комплект в <Link to="/package">Комплект</Link>.
          </p>
        )}
        <div className="stats">
          <span className="stat">
            {loading
              ? "Загрузка…"
              : filterEid !== "" || adminView
                ? `${filtered.length} из ${instances.length} форм`
                : `${instances.length} сохранённых форм`}
          </span>
          {(adminView || orgUser) && selectedOrg && (
            <span className="stat">
              {selectedOrg.name}
              {selectedPeriod ? ` · ${selectedPeriod.name}` : ""}
            </span>
          )}
          {!adminView && !orgUser && selectedPeriod && (
            <span className="stat">{selectedPeriod.name}</span>
          )}
        </div>
      </section>

      <div className="filters my-forms-filters">
        {adminView && (
          <select
            value={filterZid === "" ? "" : String(filterZid)}
            onChange={(e) => handleZidChange(e.target.value)}
            className="category-select"
            aria-label="Организация"
          >
            <option value="">Все организации</option>
            {orgs.map((o) => (
              <option key={o.zid} value={o.zid}>
                {o.name} (ZID={o.zid})
              </option>
            ))}
          </select>
        )}
        {periods.length > 0 && (
          <select
            value={filterEid === "" ? "" : String(filterEid)}
            onChange={(e) =>
              setFilterEid(e.target.value === "" ? "" : Number(e.target.value))
            }
            className="category-select"
            aria-label="Отчётный период"
          >
            <option value="">Все периоды</option>
            {periods.map((p) => (
              <option key={p.eid} value={p.eid}>
                {p.name}
                {p.periodStart || p.periodEnd
                  ? ` (${formatPeriod(p.periodStart ?? "", p.periodEnd ?? "")})`
                  : ""}
              </option>
            ))}
          </select>
        )}
        <label className="checkbox-inline my-forms-group-toggle">
          <input
            type="checkbox"
            checked={groupByPackage}
            onChange={(e) => setGroupByPackage(e.target.checked)}
          />
          {adminView ? "Группировать по организации" : "Группировать по периоду"}
        </label>
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
        {selectedCount > 0 && (
          <>
            <button
              type="button"
              className="btn btn-danger-outline"
              disabled={deleting}
              onClick={handleDeleteSelected}
            >
              {deleting ? "Удаление…" : `Удалить выбранные (${selectedCount})`}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={deleting}
              onClick={clearSelection}
            >
              Снять выбор
            </button>
          </>
        )}
      </div>

      {loading ? (
        <div className="loading">Загрузка списка форм…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          {instances.length === 0 ? (
            <>
              <p>
                {adminView
                  ? "В системе пока нет сохранённых форм."
                  : "У вас пока нет сохранённых форм."}
              </p>
              <Link
                to={adminView || orgUser ? "/package" : "/package"}
                className="btn btn-primary"
              >
                Завести комплект
              </Link>
            </>
          ) : (
            <p>Ничего не найдено по выбранным фильтрам</p>
          )}
        </div>
      ) : (
        <>
          <div className="instance-list-toolbar">
            <label className="instance-select-all">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someFilteredSelected;
                }}
                disabled={deleting}
                onChange={(e) => toggleAllFiltered(e.target.checked)}
              />
              <span>
                {allFilteredSelected
                  ? "Снять выбор со всех"
                  : `Выбрать все (${filtered.length})`}
              </span>
            </label>
            {selectedCount > 0 && (
              <span className="instance-selection-count">
                Выбрано: {selectedCount}
              </span>
            )}
          </div>
          {renderList()}
        </>
      )}
    </div>
  );
}
