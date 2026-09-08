import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  submitInstancesBulk,
} from "../storage";
import { useAuth } from "../useAuth";
import { formatPeriod, formStatusLabel } from "../utils";
import { LoadingSkeleton } from "../components/LoadingSkeleton";
import { CollapsibleFilters, countActiveFilters } from "../components/CollapsibleFilters";
import { Button, PageHeader, StatusBadge } from "../components/ui";

type FormsGroup = {
  key: string;
  title: string;
  meta: string;
  items: InstanceSummary[];
  draft: number;
  submitted: number;
  periodCount: number;
  packageLink: { zid: number; eid: number } | null;
};

function resolveOrgName(inst: InstanceSummary, orgs: Organization[]): string {
  if (inst.zid != null) {
    const org = orgs.find((o) => o.zid === inst.zid);
    if (org?.name) return org.name;
  }
  return inst.organization || "—";
}

function resolvePeriodName(
  inst: InstanceSummary,
  periods: ReportingPeriod[]
): { name: string; range: string } {
  const period =
    inst.eid != null ? periods.find((p) => p.eid === inst.eid && p.zid === inst.zid) : undefined;
  const range = formatPeriod(
    period?.periodStart ?? inst.periodStart,
    period?.periodEnd ?? inst.periodEnd
  );
  return {
    name: period?.name || range || "—",
    range: range && period?.name && period.name !== range ? range : "",
  };
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU");
  } catch {
    return iso;
  }
}

function countStatuses(items: InstanceSummary[]): { draft: number; submitted: number } {
  let draft = 0;
  let submitted = 0;
  for (const i of items) {
    if ((i.status ?? "draft") === "submitted") submitted += 1;
    else draft += 1;
  }
  return { draft, submitted };
}

function buildOrgGroups(
  items: InstanceSummary[],
  orgs: Organization[]
): FormsGroup[] {
  const map = new Map<string, InstanceSummary[]>();
  for (const inst of items) {
    const key = String(inst.zid ?? "x");
    const list = map.get(key) ?? [];
    list.push(inst);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([key, groupItems]) => {
      const sample = groupItems[0]!;
      const zid = sample.zid ?? null;
      const orgName = resolveOrgName(sample, orgs);
      const eids = new Set(groupItems.map((i) => i.eid).filter((e): e is number => e != null));
      const { draft, submitted } = countStatuses(groupItems);
      const soleEid = eids.size === 1 ? [...eids][0]! : null;
      return {
        key: `org:${key}`,
        title: orgName,
        meta:
          [
            zid != null ? `ZID ${zid}` : null,
            `${eids.size || 1} ${eids.size === 1 ? "период" : eids.size > 1 && eids.size < 5 ? "периода" : "периодов"}`,
            `${groupItems.length} форм`,
            `черновик ${draft}`,
            `сдано ${submitted}`,
          ]
            .filter(Boolean)
            .join(" · "),
        items: groupItems,
        draft,
        submitted,
        periodCount: eids.size || 1,
        packageLink:
          zid != null && soleEid != null
            ? { zid, eid: soleEid }
            : zid != null && eids.size > 0
              ? { zid, eid: [...eids][0]! }
              : null,
      };
    })
    .sort((a, b) => {
      const az = a.items[0]?.zid ?? 0;
      const bz = b.items[0]?.zid ?? 0;
      return az - bz;
    });
}

function buildPeriodGroups(
  items: InstanceSummary[],
  periods: ReportingPeriod[]
): FormsGroup[] {
  const map = new Map<string, InstanceSummary[]>();
  for (const inst of items) {
    const key = `${inst.zid ?? "x"}:${inst.eid ?? "x"}`;
    const list = map.get(key) ?? [];
    list.push(inst);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([key, groupItems]) => {
      const sample = groupItems[0]!;
      const period = resolvePeriodName(sample, periods);
      const { draft, submitted } = countStatuses(groupItems);
      const title =
        period.range && period.name !== period.range
          ? `${period.name} (${period.range})`
          : period.name;
      return {
        key: `period:${key}`,
        title,
        meta: [
          sample.eid != null ? `EID ${sample.eid}` : null,
          `${groupItems.length} форм`,
          `черновик ${draft}`,
          `сдано ${submitted}`,
        ]
          .filter(Boolean)
          .join(" · "),
        items: groupItems,
        draft,
        submitted,
        periodCount: 1,
        packageLink:
          sample.zid != null && sample.eid != null
            ? { zid: sample.zid, eid: sample.eid }
            : null,
      };
    })
    .sort((a, b) => {
      const az = a.items[0]?.zid ?? 0;
      const bz = b.items[0]?.zid ?? 0;
      if (az !== bz) return az - bz;
      return (a.items[0]?.eid ?? 0) - (b.items[0]?.eid ?? 0);
    });
}

export function MyFormsPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const adminView = isAdminFormsView(auth);
  const orgUser = isOrgFormsUser(auth);
  const orgZid = orgUser ? auth.user?.zid ?? null : null;
  const pageTitle = formsListTitle(auth);

  const [instances, setInstances] = useState<InstanceSummary[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [periods, setPeriods] = useState<ReportingPeriod[]>([]);
  const [filterZid, setFilterZid] = useState<number | "">("");
  const [filterEid, setFilterEid] = useState<number | "">("");
  const [search, setSearch] = useState("");
  const [filterTemplate, setFilterTemplate] = useState("all");
  const [filterStatus, setFilterStatus] = useState<"all" | FormInstanceStatus>("all");
  const [groupRows, setGroupRows] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const selectionBusy = deleting || submitting;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterZid, filterEid, adminView, orgZid]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const list = instances.filter((inst) => {
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
    return [...list].sort((a, b) => {
      const az = a.zid ?? 0;
      const bz = b.zid ?? 0;
      if (az !== bz) return az - bz;
      const ae = a.eid ?? 0;
      const be = b.eid ?? 0;
      if (ae !== be) return ae - be;
      return (a.templateId || "").localeCompare(b.templateId || "", "ru");
    });
  }, [instances, search, filterTemplate, filterStatus, filterZid, filterEid]);

  // Load periods for all orgs present in the list (admin all-orgs view)
  useEffect(() => {
    if (!adminView || filterZid !== "") return;
    const zids = [...new Set(instances.map((i) => i.zid).filter((z): z is number => z != null))];
    if (!zids.length) return;
    let cancelled = false;
    void (async () => {
      const all: ReportingPeriod[] = [];
      for (const zid of zids) {
        try {
          all.push(...(await listPeriods(zid)));
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) setPeriods(all);
    })();
    return () => {
      cancelled = true;
    };
  }, [adminView, filterZid, instances]);

  const groups = useMemo(() => {
    if (!groupRows) return null;
    // Admin (and multi-org) → by organization; single-org user → by period
    if (adminView) return buildOrgGroups(filtered, orgs);
    return buildPeriodGroups(filtered, periods);
  }, [groupRows, adminView, filtered, orgs, periods]);

  const showOrgColumn = !orgUser && !groupRows;
  const colCount = (showOrgColumn ? 1 : 0) + 7;

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
    return [...ids].sort((a, b) => a.localeCompare(b, "ru"));
  }, [instances]);

  const selectedOrg =
    filterZid !== "" ? orgs.find((o) => o.zid === filterZid) : undefined;
  const selectedPeriod =
    filterEid !== "" ? periods.find((p) => p.eid === filterEid) : undefined;

  const clearSelection = () => setSelectedIds(new Set());

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
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

  const toggleGroupSelection = (items: InstanceSummary[], checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const i of items) {
        if (checked) next.add(i.instanceId);
        else next.delete(i.instanceId);
      }
      return next;
    });
  };

  const toggleGroupExpanded = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleDelete = async (inst: InstanceSummary) => {
    if (!confirm(`Удалить форму «${inst.displayName}»?`)) return;
    setDeleting(true);
    try {
      await deleteInstance(inst.instanceId);
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Не удалось удалить");
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteSelected = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    if (!confirm(`Удалить выбранные формы (${ids.length})?`)) return;
    setDeleting(true);
    try {
      for (const id of ids) await deleteInstance(id);
      clearSelection();
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Не удалось удалить");
    } finally {
      setDeleting(false);
    }
  };

  const handleSubmitSelected = async () => {
    const drafts = filtered.filter(
      (i) => selectedIds.has(i.instanceId) && (i.status ?? "draft") === "draft"
    );
    if (!drafts.length) {
      alert("Среди выбранных нет черновиков для сдачи");
      return;
    }
    if (
      !confirm(
        drafts.length === 1
          ? `Сдать форму «${drafts[0]!.displayName}»?\nПосле сдачи редактирование будет недоступно.`
          : `Сдать ${drafts.length} форм?\nПосле сдачи редактирование будет недоступно.`
      )
    ) {
      return;
    }
    setSubmitting(true);
    try {
      const result = await submitInstancesBulk(drafts.map((d) => d.instanceId));
      await refresh();
      const nameById = new Map(
        drafts.map((d) => [d.instanceId, d.displayName || d.templateId])
      );
      if (result.failed.length === 0) {
        clearSelection();
        alert(
          result.submitted.length === 1
            ? "Форма сдана."
            : `Сдано форм: ${result.submitted.length}.`
        );
      } else {
        const lines = result.failed.slice(0, 12).map((f) => {
          const label = f.displayName || nameById.get(f.instanceId) || f.instanceId;
          const detail =
            f.error === "checks_failed" && f.result
              ? `проверки (ошибок: ${f.result.failed ?? 0})`
              : f.error;
          return `${label}: ${detail}`;
        });
        alert(
          `Сдано: ${result.submitted.length}. Не удалось (${result.failed.length}):\n${lines.join(
            "\n"
          )}${result.failed.length > 12 ? "\n…" : ""}`
        );
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Не удалось сдать выбранные формы");
    } finally {
      setSubmitting(false);
    }
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

  const renderFormRow = (inst: InstanceSummary): ReactNode => {
    const orgName = resolveOrgName(inst, orgs);
    const period = resolvePeriodName(inst, periods);
    const status = inst.status ?? "draft";
    return (
      <tr
        key={inst.instanceId}
        className={selectedIds.has(inst.instanceId) ? "my-forms-row-selected" : undefined}
      >
        <td>
          <input
            type="checkbox"
            checked={selectedIds.has(inst.instanceId)}
            disabled={selectionBusy}
            onChange={(e) => toggleOne(inst.instanceId, e.target.checked)}
            aria-label={`Выбрать «${inst.displayName}»`}
          />
        </td>
        <td>
          <Link to={`/my/${inst.instanceId}`} className="my-forms-name-link">
            {inst.displayName}
          </Link>
          {inst.templateTitle &&
            inst.templateTitle !== inst.displayName &&
            inst.templateTitle !== inst.templateId && (
              <div className="table-sub">{inst.templateTitle}</div>
            )}
        </td>
        <td>
          <code className="form-card-id">{inst.templateId}</code>
        </td>
        {showOrgColumn && (
          <td>
            <div>{orgName}</div>
            {adminView && (inst.zid != null || inst.eid != null) && (
              <div className="table-sub">
                ZID {inst.zid ?? "—"}
                {inst.eid != null ? ` · EID ${inst.eid}` : ""}
              </div>
            )}
          </td>
        )}
        <td>
          <div>{period.name}</div>
          {period.range ? <div className="table-sub">{period.range}</div> : null}
        </td>
        <td>
          <span>
            <StatusBadge status={status} label={formStatusLabel(status)} />
          </span>
        </td>
        <td>
          <div>{formatDateTime(inst.updatedAt)}</div>
          <div className="table-sub">создано {formatDateTime(inst.createdAt)}</div>
        </td>
        <td>
          <div className="my-forms-row-actions">
            <Link to={`/my/${inst.instanceId}`} className="btn btn-primary btn-sm">
              Открыть
            </Link>
            <button
              type="button"
              className="btn btn-danger-outline btn-sm"
              disabled={selectionBusy}
              onClick={() => void handleDelete(inst)}
            >
              Удалить
            </button>
          </div>
        </td>
      </tr>
    );
  };

  const renderGroupedBody = (): ReactNode => {
    if (!groups?.length) return null;
    const rows: ReactNode[] = [];
    for (const group of groups) {
      const expanded = expandedGroups.has(group.key);
      const ids = group.items.map((i) => i.instanceId);
      const allSelected = ids.length > 0 && ids.every((id) => selectedIds.has(id));
      const someSelected = ids.some((id) => selectedIds.has(id)) && !allSelected;
      const zid = group.items[0]?.zid;
      rows.push(
        <tr key={group.key} className="my-forms-group-row">
          <td colSpan={colCount}>
            <div className="my-forms-group-inner">
              <label className="my-forms-group-check">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  disabled={selectionBusy || !group.items.length}
                  onChange={(e) => toggleGroupSelection(group.items, e.target.checked)}
                  aria-label={`Выбрать группу «${group.title}»`}
                />
              </label>
              <button
                type="button"
                className="my-forms-group-toggle"
                onClick={() => toggleGroupExpanded(group.key)}
                aria-expanded={expanded}
              >
                <span className="my-forms-group-chevron" aria-hidden>
                  {expanded ? "▾" : "▸"}
                </span>
                <span className="my-forms-group-title">
                  {group.title}
                  {zid != null ? <span className="my-forms-group-zid">ZID {zid}</span> : null}
                </span>
                <span className="my-forms-group-stats">
                  <span>{group.periodCount} {group.periodCount === 1 ? "период" : "периодов"}</span>
                  <span>{group.items.length} форм</span>
                  <span>{group.draft} черновик</span>
                  <span>{group.submitted} сдано</span>
                </span>
              </button>
              {group.packageLink && (
                <Link
                  to={`/package?zid=${group.packageLink.zid}&eid=${group.packageLink.eid}`}
                  className="my-forms-group-link"
                >
                  Комплект
                </Link>
              )}
            </div>
          </td>
        </tr>
      );
      if (expanded) {
        for (const inst of group.items) {
          rows.push(renderFormRow(inst));
        }
      }
    }
    return rows;
  };

  return (
    <div className="my-forms-page">
      <section className="hero hero-compact">
        <div className="hero-compact-main">
          <PageHeader
            title={pageTitle}
            description={
              adminView ? (
                <>
                  Все экземпляры по организациям и периодам. Контекст — в{" "}
                  <Link to="/package">Комплект</Link>, проверки — в{" "}
                  <Link to="/tools">Обмен и операции</Link>.
                </>
              ) : orgUser ? (
                <>
                  Формы вашей организации. Полный набор — в{" "}
                  <Link to="/package">Комплект</Link>.
                </>
              ) : (
                <>
                  Заполненные формы по периодам. Новую — в{" "}
                  <Link to="/catalog">каталоге</Link> или{" "}
                  <Link to="/package">Комплект</Link>.
                </>
              )
            }
          />
        </div>
        <div className="stats">
          <span className="stat">
            <strong>
              {loading
                ? "…"
                : filterEid !== "" || adminView
                  ? `${filtered.length}`
                  : `${instances.length}`}
            </strong>
            <span>
              {loading
                ? "загрузка"
                : filterEid !== "" || adminView
                  ? `из ${instances.length} форм`
                  : "сохранённых форм"}
            </span>
          </span>
          {(adminView || orgUser) && selectedOrg && (
            <span className="stat">
              <strong>{selectedOrg.name}</strong>
              <span>{selectedPeriod ? selectedPeriod.name : "организация"}</span>
            </span>
          )}
          {!adminView && !orgUser && selectedPeriod && (
            <span className="stat">
              <strong>{selectedPeriod.name}</strong>
              <span>период</span>
            </span>
          )}
        </div>
      </section>

      <div className="my-forms-toolbar">
        <CollapsibleFilters
          activeCount={countActiveFilters(
            adminView && filterZid !== "",
            filterEid !== "",
            search.trim().length > 0,
            filterTemplate !== "all",
            filterStatus !== "all",
            !groupRows
          )}
          bodyClassName="filters my-forms-filters"
        >
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
                  {o.name}
                  {o.code ? ` (${o.code})` : ""}
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
                <option key={`${p.zid}-${p.eid}`} value={p.eid}>
                  {p.name}
                  {p.periodStart || p.periodEnd
                    ? ` (${formatPeriod(p.periodStart ?? "", p.periodEnd ?? "")})`
                    : ""}
                </option>
              ))}
            </select>
          )}
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
          <label className="checkbox-inline my-forms-group-toggle">
            <input
              type="checkbox"
              checked={groupRows}
              onChange={(e) => setGroupRows(e.target.checked)}
            />
            {adminView ? "Группировать по организации" : "Группировать по периоду"}
          </label>
        </CollapsibleFilters>
        <div className="checks-filters-actions">
          <Button
            variant="secondary"
            onClick={() => {
              const input = document.getElementById("import-instance") as HTMLInputElement;
              input?.click();
            }}
          >
            Импорт комплекта
          </Button>
          <input
            id="import-instance"
            type="file"
            accept=".json"
            hidden
            onChange={handleImport}
          />
          {selectedCount > 0 && (
            <>
              <Button disabled={selectionBusy} onClick={handleSubmitSelected}>
                {submitting ? "Сдача…" : `Сдать выбранные (${selectedCount})`}
              </Button>
              <Button
                variant="danger-outline"
                disabled={selectionBusy}
                onClick={handleDeleteSelected}
              >
                {deleting ? "Удаление…" : `Удалить выбранные (${selectedCount})`}
              </Button>
              <Button variant="secondary" disabled={selectionBusy} onClick={clearSelection}>
                Снять выбор
              </Button>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton variant="rows" count={8} label="Загрузка списка форм…" />
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          {instances.length === 0 ? (
            <>
              <p>
                {adminView
                  ? "В системе пока нет сохранённых форм."
                  : "У вас пока нет сохранённых форм."}
              </p>
              <Link to="/package" className="btn btn-primary">
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
                disabled={selectionBusy}
                onChange={(e) => toggleAllFiltered(e.target.checked)}
              />
              <span>
                {allFilteredSelected
                  ? "Снять выбор со всех"
                  : `Выбрать все (${filtered.length})`}
              </span>
            </label>
            {selectedCount > 0 && (
              <span className="instance-selection-count">Выбрано: {selectedCount}</span>
            )}
            {groupRows && groups && (
              <span className="instance-selection-count">
                Групп: {groups.length}
              </span>
            )}
            {groupRows && groups && groups.length > 0 && (
              <div className="my-forms-expand-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setExpandedGroups(new Set(groups.map((g) => g.key)))}
                >
                  Развернуть все
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setExpandedGroups(new Set())}>
                  Свернуть все
                </Button>
              </div>
            )}
          </div>

          <div className="table-wrap my-forms-table-wrap">
            <table className="form-table my-forms-table">
              <thead>
                <tr>
                  <th className="table-col-check" />
                  <th>Форма</th>
                  <th>Шаблон</th>
                  {showOrgColumn && <th>Организация</th>}
                  <th>Период</th>
                  <th>Статус</th>
                  <th>Изменено</th>
                  <th className="table-col-actions" />
                </tr>
              </thead>
              <tbody>
                {groupRows ? renderGroupedBody() : filtered.map((inst) => renderFormRow(inst))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
