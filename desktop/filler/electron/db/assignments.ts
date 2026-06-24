import fs from "node:fs";
import path from "node:path";

export type AssignmentStatus = "assigned" | "in_progress" | "ready" | "accepted";

export interface AssignmentItem {
  templateId: string;
  assignee: string;
  status: AssignmentStatus;
}

export interface AssignmentsFile {
  updatedAt: string;
  items: AssignmentItem[];
}

export const ASSIGNMENTS_FILE = "assignments.json";

export function assignmentsPath(folderPath: string): string {
  return path.join(folderPath, ASSIGNMENTS_FILE);
}

export function readAssignments(folderPath: string): AssignmentsFile {
  const p = assignmentsPath(folderPath);
  if (!fs.existsSync(p)) {
    return { updatedAt: new Date(0).toISOString(), items: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as AssignmentsFile;
  } catch {
    return { updatedAt: new Date(0).toISOString(), items: [] };
  }
}

export function writeAssignments(folderPath: string, items: AssignmentItem[]): AssignmentsFile {
  const data: AssignmentsFile = {
    updatedAt: new Date().toISOString(),
    items,
  };
  fs.writeFileSync(assignmentsPath(folderPath), JSON.stringify(data, null, 2), "utf8");
  return data;
}

export function assignmentMap(folderPath: string): Map<string, AssignmentItem> {
  const file = readAssignments(folderPath);
  return new Map(file.items.map((i) => [i.templateId, i]));
}

export function listKnownAssignees(folderPath: string): string[] {
  const names = new Set<string>();
  for (const item of readAssignments(folderPath).items) {
    if (item.assignee.trim()) names.add(item.assignee.trim());
  }
  return [...names].sort((a, b) => a.localeCompare(b, "ru"));
}

export function canUserAccessForm(
  templateId: string,
  userName: string,
  folderPath: string,
  restrictToAssignments: boolean,
  isCoordinator: boolean
): boolean {
  if (isCoordinator || !restrictToAssignments) return true;
  const item = assignmentMap(folderPath).get(templateId);
  if (!item?.assignee) return true;
  return item.assignee.toLowerCase() === userName.toLowerCase();
}
