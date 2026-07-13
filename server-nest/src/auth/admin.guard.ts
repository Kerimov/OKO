import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { isAuthEnabled } from "../../../server/src/auth.js";
import type { OkoRequest } from "./decorators/oko-request.decorator.js";

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<OkoRequest>();
    if (!isAuthEnabled() || req.apiRole === "admin") {
      return true;
    }
    throw new ForbiddenException({ error: "Admin required" });
  }
}
