/**
 * Lightweight DTO validation helpers for PSD endpoints (no class-validator dependency).
 */

export type DtoIssue = { field: string; message: string };

export class DtoValidationError extends Error {
  readonly status = 400;
  readonly issues: DtoIssue[];

  constructor(issues: DtoIssue[]) {
    super(issues.map((i) => `${i.field}: ${i.message}`).join("; ") || "Invalid body");
    this.name = "DtoValidationError";
    this.issues = issues;
  }
}

export function requireNumber(
  body: Record<string, unknown>,
  field: string,
  issues: DtoIssue[]
): number | undefined {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === "") {
    issues.push({ field, message: "required" });
    return undefined;
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    issues.push({ field, message: "must be a finite number" });
    return undefined;
  }
  return n;
}

export function requireString(
  body: Record<string, unknown>,
  field: string,
  issues: DtoIssue[],
  opts?: { minLen?: number }
): string | undefined {
  const raw = body[field];
  if (typeof raw !== "string" || !raw.trim()) {
    issues.push({ field, message: "required string" });
    return undefined;
  }
  const v = raw.trim();
  if (opts?.minLen != null && v.length < opts.minLen) {
    issues.push({ field, message: `min length ${opts.minLen}` });
    return undefined;
  }
  return v;
}

export function requireEnum<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  issues: DtoIssue[]
): T | undefined {
  const raw = body[field];
  if (typeof raw !== "string" || !(allowed as readonly string[]).includes(raw)) {
    issues.push({ field, message: `must be one of: ${allowed.join(" | ")}` });
    return undefined;
  }
  return raw as T;
}

export function assertNoIssues(issues: DtoIssue[]): void {
  if (issues.length > 0) throw new DtoValidationError(issues);
}

export function parseBpEnsureBody(body: unknown): {
  zid: number;
  eid: number;
  packageKind?: string;
} {
  const b = (body ?? {}) as Record<string, unknown>;
  const issues: DtoIssue[] = [];
  const zid = requireNumber(b, "zid", issues);
  const eid = requireNumber(b, "eid", issues);
  assertNoIssues(issues);
  return {
    zid: zid!,
    eid: eid!,
    packageKind: typeof b.packageKind === "string" ? b.packageKind : undefined,
  };
}

export function parseTransferApplyBody(body: unknown): {
  kind: "period_to_period" | "balance_to_oko" | "oko_to_balance";
  sourceZid: number;
  sourceEid: number;
  targetZid: number;
  targetEid: number;
  packageKind?: "OKO" | "BALANCE";
  dryRun?: boolean;
} {
  const b = (body ?? {}) as Record<string, unknown>;
  const issues: DtoIssue[] = [];
  const kind = requireEnum(
    b,
    "kind",
    ["period_to_period", "balance_to_oko", "oko_to_balance"] as const,
    issues
  );
  const sourceZid = requireNumber(b, "sourceZid", issues);
  const sourceEid = requireNumber(b, "sourceEid", issues);
  const targetZid = requireNumber(b, "targetZid", issues);
  const targetEid = requireNumber(b, "targetEid", issues);
  assertNoIssues(issues);
  return {
    kind: kind!,
    sourceZid: sourceZid!,
    sourceEid: sourceEid!,
    targetZid: targetZid!,
    targetEid: targetEid!,
    packageKind: b.packageKind === "BALANCE" ? "BALANCE" : "OKO",
    dryRun: Boolean(b.dryRun),
  };
}
