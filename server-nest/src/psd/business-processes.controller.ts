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
  assignBpCurator,
  ensureBusinessProcess,
  listBpEvents,
  listBusinessProcesses,
  transitionBusinessProcess,
  type BpAction,
} from "../../../server/src/businessProcess.js";
import { resolvePsdRole, type PsdRole } from "../../../server/src/psdRoles.js";
import { getApprovalBlockers } from "../../../server/src/checkJournal.js";
import { normalizePackageKind } from "../../../server/src/businessProcessTypes.js";
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
    body: { zid: number; eid: number; packageKind?: string }
  ) {
    if (!body?.zid || !body?.eid) {
      throw new BadRequestException({ error: "zid and eid required" });
    }
    return ensureBusinessProcess(
      await getDb(),
      Number(body.zid),
      Number(body.eid),
      normalizePackageKind(body.packageKind)
    );
  }

  @Get(":id")
  @RequirePsdPermissions("bp.view")
  async get(@Param("id") id: string) {
    const list = await listBusinessProcesses(await getDb(), {});
    const bp = list.find((b) => b.id === id);
    if (!bp) throw new NotFoundException({ error: "Not found" });
    return bp;
  }

  @Get(":id/events")
  @RequirePsdPermissions("bp.view")
  async events(@Param("id") id: string) {
    return listBpEvents(await getDb(), id);
  }

  @Get(":id/approval-blockers")
  @RequirePsdPermissions("bp.view")
  async blockers(@Param("id") id: string) {
    const list = await listBusinessProcesses(await getDb(), {});
    const bp = list.find((b) => b.id === id);
    if (!bp) throw new NotFoundException({ error: "Not found" });
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
