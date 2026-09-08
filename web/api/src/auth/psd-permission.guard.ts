import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { isAuthEnabled } from "../../../domain/src/auth.js";
import {
  hasPermission,
  resolvePsdRole,
  type PsdPermission,
} from "../../../domain/src/psdRoles.js";
import { allPermissionsSet } from "../../../domain/src/rbac.js";
import type { OkoRequest } from "./decorators/oko-request.decorator.js";

export const PSD_PERMISSIONS_KEY = "psd_permissions";

/** Require ANY of the listed permissions (OR). Pass one for a hard requirement. */
export const RequirePsdPermissions = (...permissions: PsdPermission[]) =>
  SetMetadata(PSD_PERMISSIONS_KEY, permissions);

@Injectable()
export class PsdPermissionGuard implements CanActivate {
  private readonly reflector = new Reflector();

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PsdPermission[]>(PSD_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    if (!isAuthEnabled()) return true;

    const req = context.switchToHttp().getRequest<OkoRequest>();
    const legacyRole = req.apiUser?.role ?? (req.apiRole === "admin" ? "admin" : "org");
    // Platform admin has full catalog
    if (legacyRole === "admin" || req.apiRole === "admin") {
      const full = allPermissionsSet();
      if (required.some((p) => full.has(p))) return true;
    }
    const role = resolvePsdRole({
      legacyRole,
      psdRole: req.apiUser?.psdRole,
    });
    const ok = required.some((p) => hasPermission(role, p));
    if (!ok) {
      throw new ForbiddenException({
        error: `PSD permission required: ${required.join(" | ")}`,
        psdRole: role,
      });
    }
    return true;
  }
}
