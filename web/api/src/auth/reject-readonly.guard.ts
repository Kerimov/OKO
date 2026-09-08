import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { isAuthEnabled } from "../../../server/src/auth.js";
import { resolvePsdRole } from "../../../server/src/psdRoles.js";
import type { OkoRequest } from "./decorators/oko-request.decorator.js";

/** Block mutating verbs for auditor_readonly. */
@Injectable()
export class RejectReadOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!isAuthEnabled()) return true;
    const req = context.switchToHttp().getRequest<OkoRequest>();
    const method = req.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
    const role = resolvePsdRole({
      legacyRole: req.apiUser?.role,
      psdRole: req.apiUser?.psdRole,
    });
    if (role === "auditor_readonly") {
      throw new ForbiddenException({ error: "Read-only auditor cannot mutate data" });
    }
    return true;
  }
}
