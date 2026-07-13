import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  extractToken,
  isAuthEnabled,
  isPublicApiPath,
  resolveAuth,
} from "../../../server/src/auth.js";
import type { OkoRequest } from "./decorators/oko-request.decorator.js";
import { IS_PUBLIC_KEY } from "./decorators/public.decorator.js";

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly reflector = new Reflector();

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<OkoRequest>();
    const isPublic =
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) || isPublicApiPath(req.path);

    if (isPublic) {
      const token = extractToken(req);
      if (token) await resolveAuth(req, token);
      else if (!isAuthEnabled()) req.apiRole = "admin";
      return true;
    }

    if (!isAuthEnabled()) {
      req.apiRole = "admin";
      return true;
    }

    const token = extractToken(req);
    if (!(await resolveAuth(req, token ?? null))) {
      throw new UnauthorizedException({ error: "Unauthorized", authRequired: true });
    }
    return true;
  }
}
