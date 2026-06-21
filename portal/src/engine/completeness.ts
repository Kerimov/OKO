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

export async function getCompleteness(
  summaries: InstanceSummary[],
  period?: { start: string; end: string }
): Promise<{ total: number; filled: number; items: CompletenessItem[] }> {
  const catalog = await loadCatalog();
  const filtered = summaries.filter((s) => {
    if (period?.start && s.periodStart !== period.start) return false;
    if (period?.end && s.periodEnd !== period.end) return false;
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
