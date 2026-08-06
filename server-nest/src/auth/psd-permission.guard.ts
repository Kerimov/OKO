import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { isAuthEnabled } from "../../../server/src/auth.js";
import {
  hasPermission,
  resolvePsdRole,
  type PsdPermission,
} from "../../../server/src/psdRoles.js";
import type { OkoRequest } from "./decorators/oko-request.decorator.js";

export const PSD_PERMISSIONS_KEY = "psd_permissions";

/** Require ANY of the listed permissions (OR). Pass one for a hard requirement. */
export const RequirePsdPermissions = (...permissions: PsdPermission[]) =>
  SetMetadata(PSD_PERMISSIONS_KEY, permissions);

@Injectable()
export class PsdPermissionGuard implements CanActivate {
  // Avoid constructor DI for Reflector: Nest sometimes instantiates
  // `@UseGuards(PsdPermissionGuard)` without injecting deps → 500.
  private readonly reflector = new Reflector();

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PsdPermission[]>(PSD_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    if (!isAuthEnabled()) return true;

    const req = context.switchToHttp().getRequest<OkoRequest>();
    const role = resolvePsdRole({
      legacyRole: req.apiUser?.role ?? (req.apiRole === "admin" ? "admin" : "org"),
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
