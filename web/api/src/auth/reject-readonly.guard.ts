import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { isAuthEnabled } from "../../../domain/src/auth.js";
import { isEffectivelyReadOnly, resolvePsdRole } from "../../../domain/src/psdRoles.js";
import type { OkoRequest } from "./decorators/oko-request.decorator.js";

/** Block mutating verbs for effectively read-only roles. */
@Injectable()
export class RejectReadOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!isAuthEnabled()) return true;
    const req = context.switchToHttp().getRequest<OkoRequest>();
    const method = req.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
    if (req.apiUser?.role === "admin" || req.apiRole === "admin") return true;
    const role = resolvePsdRole({
      legacyRole: req.apiUser?.role,
      psdRole: req.apiUser?.psdRole,
    });
    if (isEffectivelyReadOnly(role)) {
      throw new ForbiddenException({ error: "Read-only role cannot mutate data" });
    }
    return true;
  }
}
