import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { getDb } from "../../../server/src/db.js";
import {
  assertBpOrgAccess,
  assignBpCurator,
  ensureBusinessProcess,
  getBusinessProcess,
  listBpEvents,
  listBusinessProcesses,
  transitionBusinessProcess,
  type BpAction,
} from "../../../server/src/businessProcess.js";
import { normalizePackageKind } from "../../../server/src/businessProcessTypes.js";
import {
  DtoValidationError,
  parseBpEnsureBody,
} from "../../../server/src/psdDto.js";
import { resolvePsdRole, type PsdRole } from "../../../server/src/psdRoles.js";
import { getApprovalBlockers } from "../../../server/src/checkJournal.js";
import {
  ApiRoleParam,
  ReqUser,
} from "../auth/decorators/oko-request.decorator.js";
import { PsdPermissionGuard, RequirePsdPermissions } from "./psd-permission.guard.js";
import type { SessionUser } from "../../../server/src/users.js";
import type { ApiRole } from "../../../server/src/auth.js";

function roleOf(user: SessionUser | undefined, apiRole: ApiRole | undefined): PsdRole {
  return resolvePsdRole({
    legacyRole: user?.role ?? (apiRole === "admin" ? "admin" : "org"),
    psdRole: user?.psdRole,
  });
}

@ApiTags("business-processes")
@ApiBearerAuth()
@UseGuards(PsdPermissionGuard)
@Controller("business-processes")
export class BusinessProcessesController {
  @Get()
  @RequirePsdPermissions("bp.view")
  @ApiOperation({ summary: "Список БП / мониторинг" })
  async list(
    @Query("eid") eid?: string,
    @Query("zid") zid?: string,
    @Query("status") status?: string,
    @Query("packageKind") packageKind?: string,
    @Query("curatorUserId") curatorUserId?: string,
    @ReqUser() user?: SessionUser,
    @ApiRoleParam() apiRole?: ApiRole
  ) {
    const db = await getDb();
    const filter: Parameters<typeof listBusinessProcesses>[1] = {};
    if (eid) filter.eid = Number(eid);
    if (zid) filter.zid = Number(zid);
    if (status) filter.status = status as never;
    if (packageKind) filter.packageKind = normalizePackageKind(packageKind);
    if (curatorUserId) filter.curatorUserId = Number(curatorUserId);

    // Org-scoped subsidiary sees only own zid
    const psd = roleOf(user, apiRole);
    if (psd === "subsidiary_specialist" && user?.zid != null) {
      filter.zid = user.zid;
    }
    return listBusinessProcesses(db, filter);
  }

  @Post("ensure")
  @HttpCode(200)
  @RequirePsdPermissions("bp.view")
  async ensure(
    @Body()
    body: { zid: number; eid: number; packageKind?: string },
    @ReqUser() user?: SessionUser
  ) {
    let parsed: { zid: number; eid: number; packageKind?: string };
    try {
      parsed = parseBpEnsureBody(body);
    } catch (e) {
      if (e instanceof DtoValidationError) {
        throw new BadRequestException({ error: e.message, issues: e.issues });
      }
      throw e;
    }
    const { zid, eid } = parsed;
    try {
      assertBpOrgAccess(
        {
          id: "",
          eid,
          zid,
          packageKind: "OKO",
          status: "not_started",
          curatorUserId: null,
          deadlineAt: null,
          iteration: 0,
          note: null,
          lastChangedAt: null,
          lastChangedBy: null,
          createdAt: "",
        },
        user
      );
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) throw new ForbiddenException({ error: err.message });
      throw e;
    }
    return ensureBusinessProcess(
      await getDb(),
      zid,
      eid,
      normalizePackageKind(parsed.packageKind)
    );
  }

  @Get(":id")
  @RequirePsdPermissions("bp.view")
  async get(@Param("id") id: string, @ReqUser() user?: SessionUser) {
    const bp = await getBusinessProcess(await getDb(), id);
    if (!bp) throw new NotFoundException({ error: "Not found" });
    try {
      assertBpOrgAccess(bp, user);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) throw new ForbiddenException({ error: err.message });
      throw e;
    }
    return bp;
  }

  @Get(":id/events")
  @RequirePsdPermissions("bp.view")
  async events(@Param("id") id: string, @ReqUser() user?: SessionUser) {
    const bp = await getBusinessProcess(await getDb(), id);
    if (!bp) throw new NotFoundException({ error: "Not found" });
    try {
      assertBpOrgAccess(bp, user);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) throw new ForbiddenException({ error: err.message });
      throw e;
    }
    return listBpEvents(await getDb(), id);
  }

  @Get(":id/approval-blockers")
  @RequirePsdPermissions("bp.view")
  async blockers(@Param("id") id: string, @ReqUser() user?: SessionUser) {
    const bp = await getBusinessProcess(await getDb(), id);
    if (!bp) throw new NotFoundException({ error: "Not found" });
    try {
      assertBpOrgAccess(bp, user);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) throw new ForbiddenException({ error: err.message });
      throw e;
    }
    return getApprovalBlockers(await getDb(), bp.zid, bp.eid, bp.packageKind);
  }

  @Post(":id/transition")
  @HttpCode(200)
  @ApiOperation({ summary: "Переход статуса БП" })
  async transition(
    @Param("id") id: string,
    @Body() body: { action: BpAction; note?: string },
    @ReqUser() user?: SessionUser,
    @ApiRoleParam() apiRole?: ApiRole
  ) {
    if (!body?.action) throw new BadRequestException({ error: "action required" });
    const psd = roleOf(user, apiRole);
    try {
      const bp = await getBusinessProcess(await getDb(), id);
      if (!bp) throw Object.assign(new Error("Not found"), { status: 404 });
      assertBpOrgAccess(bp, user);
      return await transitionBusinessProcess(await getDb(), {
        id,
        action: body.action,
        actor: user?.username ?? "system",
        psdRole: psd,
        note: body.note,
      });
    } catch (e) {
      const err = e as Error & {
        status?: number;
        missingExplanations?: unknown;
      };
      if (err.status === 403) throw new ForbiddenException({ error: err.message });
      if (err.status === 404) throw new NotFoundException({ error: err.message });
      if (err.status === 409) {
        throw new ConflictException({
          error: err.message,
          missingExplanations: err.missingExplanations,
        });
      }
      throw new BadRequestException({ error: err.message });
    }
  }

  @Put(":id/curator")
  @RequirePsdPermissions("bp.assign_curator")
  async assignCurator(
    @Param("id") id: string,
    @Body() body: { curatorUserId: number | null; deadlineAt?: string | null },
    @ReqUser() user?: SessionUser,
    @ApiRoleParam() apiRole?: ApiRole
  ) {
    try {
      const bp = await getBusinessProcess(await getDb(), id);
      if (!bp) throw Object.assign(new Error("Not found"), { status: 404 });
      assertBpOrgAccess(bp, user);
      return await assignBpCurator(await getDb(), {
        id,
        curatorUserId: body.curatorUserId ?? null,
        deadlineAt: body.deadlineAt,
        actor: user?.username ?? "system",
        psdRole: roleOf(user, apiRole),
      });
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) throw new ForbiddenException({ error: err.message });
      if (err.status === 404) throw new NotFoundException({ error: err.message });
      throw new BadRequestException({ error: err.message });
    }
  }
}
