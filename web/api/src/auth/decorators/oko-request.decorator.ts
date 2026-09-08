import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { ApiRole } from "../../../../server/src/auth.js";
import type { SessionUser } from "../../../../server/src/users.js";

export interface OkoRequest extends Request {
  apiRole?: ApiRole;
  apiUser?: SessionUser;
  sessionToken?: string;
}

export const ReqUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser | undefined => {
    const req = ctx.switchToHttp().getRequest<OkoRequest>();
    return req.apiUser;
  }
);

export const ApiRoleParam = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApiRole | undefined => {
    const req = ctx.switchToHttp().getRequest<OkoRequest>();
    return req.apiRole;
  }
);
