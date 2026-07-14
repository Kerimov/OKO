import type { Request, Response, NextFunction } from "express";
import type { OkoFormInstance } from "./types.js";

export function isOrgScopedUser(req: Request): boolean {
  return req.apiRole === "user" && req.apiUser?.role === "org" && req.apiUser.zid != null;
}

export function userZid(req: Request): number | null {
  if (req.apiRole === "admin") return null;
  return req.apiUser?.zid ?? null;
}

export function mergeOrgFilter(
  req: Request,
  filter?: { zid?: number; eid?: number }
): { zid?: number; eid?: number } | undefined {
  const zid = userZid(req);
  if (zid == null) return filter;
  return { ...filter, zid };
}

export function assertOrgInstanceAccess(req: Request, inst: OkoFormInstance): void {
  const zid = userZid(req);
  if (zid == null) return;
  if (inst.zid == null || inst.zid !== zid) {
    const err = new Error("Access denied for this organization");
    (err as Error & { status: number }).status = 403;
    throw err;
  }
}

export function enforceOrgInstanceWrite(req: Request, inst: OkoFormInstance): OkoFormInstance {
  const zid = userZid(req);
  if (zid == null) return inst;
  return { ...inst, zid };
}

export function assertOrgZidParam(req: Request, zid: number): void {
  const userOrg = userZid(req);
  if (userOrg == null) return;
  if (userOrg !== zid) {
    const err = new Error("Access denied for this organization");
    (err as Error & { status: number }).status = 403;
    throw err;
  }
}

/**
 * Org users may write aggregation only into their parent ZID or a registered
 * correcting set of that parent. Admins are unrestricted.
 */
export function assertAggregationTargetZid(
  req: Request,
  parentZid: number,
  targetZid: number | null | undefined,
  allowedCorrZids: number[]
): void {
  assertOrgZidParam(req, parentZid);
  const target = targetZid ?? parentZid;
  if (userZid(req) == null) return;
  if (target === parentZid) return;
  if (!allowedCorrZids.includes(target)) {
    const err = new Error("Access denied for target organization");
    (err as Error & { status: number }).status = 403;
    throw err;
  }
}

export function handleOrgError(
  res: Response,
  e: unknown,
  fallback = "Forbidden"
): boolean {
  const err = e as Error & { status?: number };
  if (err.status === 403) {
    res.status(403).json({ error: err.message || fallback });
    return true;
  }
  return false;
}

export function blockOrgFromAdminRoutes(req: Request, res: Response, next: NextFunction): void {
  if (isOrgScopedUser(req)) {
    res.status(403).json({ error: "Admin required" });
    return;
  }
  next();
}
