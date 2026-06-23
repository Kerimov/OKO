import { loadCatalog } from "../api";
import type { InstanceSummary } from "../types";

export interface CompletenessItem {
  formId: string;
  title: string;
  category: string;
  filled: boolean;
  instanceId?: string;
  displayName?: string;
}

function numId(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export async function getCompleteness(
  summaries: InstanceSummary[],
  filter?: { zid?: number; eid?: number; start?: string; end?: string }
): Promise<{ total: number; filled: number; items: CompletenessItem[] }> {
  const catalog = await loadCatalog();
  const filterZid = filter?.zid != null ? numId(filter.zid) : null;
  const filterEid = filter?.eid != null ? numId(filter.eid) : null;
  const filtered = summaries.filter((s) => {
    if (filterZid != null && numId(s.zid) !== filterZid) return false;
    if (filterEid != null && numId(s.eid) !== filterEid) return false;
    if (filterZid == null && filterEid == null) {
      if (filter?.start && s.periodStart !== filter.start) return false;
      if (filter?.end && s.periodEnd !== filter.end) return false;
    }
    return true;
  });

  const latestByTemplate = new Map<string, InstanceSummary>();
  for (const s of filtered) {
    const prev = latestByTemplate.get(s.templateId);
    if (!prev || s.updatedAt > prev.updatedAt) {
      latestByTemplate.set(s.templateId, s);
    }
  }

  const items: CompletenessItem[] = catalog.forms.map((f) => {
    const inst = latestByTemplate.get(f.id);
    return {
      formId: f.id,
      title: f.title,
      category: f.category,
      filled: !!inst,
      instanceId: inst?.instanceId,
      displayName: inst?.displayName,
    };
  });

  const filled = items.filter((i) => i.filled).length;
  return { total: items.length, filled, items };
}
