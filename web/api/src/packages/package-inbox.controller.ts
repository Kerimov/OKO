import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { getDb } from "../../../server/src/db.js";
import { logDomainAudit } from "../../../server/src/audit.js";
import {
  acceptPackageInbox,
  getPackageInboxDetail,
  listPackageInbox,
  previewPackageInbox,
  receivePackageInbox,
  rejectPackageInbox,
  type InboxStatus,
} from "../../../server/src/packageInbox.js";
import { AdminGuard } from "../auth/admin.guard.js";
import type { OkoRequest } from "../auth/decorators/oko-request.decorator.js";
import { rethrowAsHttp } from "../common/oko-http.js";
import {
  InboxAcceptDto,
  InboxReceiveDto,
  InboxRejectDto,
} from "./dto/inbox.dto.js";

@ApiTags("packages-inbox")
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller("packages/inbox")
export class PackageInboxController {
  @Get()
  @ApiOperation({ summary: "Список inbox комплектов (admin)" })
  @ApiQuery({ name: "status", required: false })
  async list(@Query("status") status?: string) {
    return listPackageInbox(
      await getDb(),
      status as InboxStatus | undefined
    );
  }

  @Get(":id/preview")
  @ApiOperation({ summary: "Превью diff inbox vs целевой комплект (admin)" })
  @ApiQuery({ name: "zid", required: true })
  @ApiQuery({ name: "eid", required: true })
  async preview(
    @Param("id") id: string,
    @Query("zid") zidRaw?: string,
    @Query("eid") eidRaw?: string
  ) {
    const zid = Number(zidRaw);
    const eid = Number(eidRaw);
    if (!Number.isFinite(zid) || !Number.isFinite(eid) || zid <= 0 || eid <= 0) {
      throw new BadRequestException({ error: "zid and eid required" });
    }
    const item = await previewPackageInbox(await getDb(), id, { zid, eid });
    if (!item) throw new NotFoundException({ error: "Not found" });
    return item;
  }

  @Get(":id")
  @ApiOperation({ summary: "Детали inbox + payload (admin)" })
  async getOne(@Param("id") id: string) {
    const item = await getPackageInboxDetail(await getDb(), id);
    if (!item) throw new NotFoundException({ error: "Not found" });
    return item;
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: "Положить комплект в quarantine/inbox (admin)" })
  async receive(@Req() req: OkoRequest, @Body() body: InboxReceiveDto) {
    if (!body.rawJson?.trim() && !body.package) {
      throw new BadRequestException({ error: "rawJson or package required" });
    }
    try {
      const raw =
        body.rawJson?.trim() ||
        JSON.stringify(body.package, null, 2);
      return receivePackageInbox(await getDb(), {
        rawJson: raw!,
        filename: body.filename ?? null,
        actor: req.apiUser?.username ?? req.apiRole ?? null,
        targetZid: body.targetZid ?? null,
        targetEid: body.targetEid ?? null,
      });
    } catch (e) {
      rethrowAsHttp(e, "inbox receive failed");
    }
  }

  @Post(":id/reject")
  @ApiOperation({ summary: "Отклонить inbox (admin)" })
  async reject(@Req() req: OkoRequest, @Param("id") id: string, @Body() body: InboxRejectDto) {
    const db = await getDb();
    const item = await rejectPackageInbox(db, id, body.reason ?? null);
    if (!item) throw new NotFoundException({ error: "Not found or wrong status" });
    await logDomainAudit(db, {
      actor: req.apiUser?.username ?? req.apiRole ?? null,
      action: "packages.inbox.reject",
      entityType: "package_inbox",
      entityId: id,
      details: { reason: body.reason ?? null, sha256: item.sha256 },
    });
    return item;
  }

  @Post(":id/accept")
  @ApiOperation({ summary: "Принять inbox в целевой комплект (admin)" })
  async accept(@Req() req: OkoRequest, @Param("id") id: string, @Body() body: InboxAcceptDto) {
    if (!body.zid || !body.eid) {
      throw new BadRequestException({ error: "zid and eid required" });
    }
    try {
      const db = await getDb();
      const result = await acceptPackageInbox(db, id, {
        zid: body.zid,
        eid: body.eid,
        overwrite: body.overwrite === true,
        templateIds: body.templateIds,
        isAdmin: true,
      });
      await logDomainAudit(db, {
        actor: req.apiUser?.username ?? req.apiRole ?? null,
        action: "packages.inbox.accept",
        entityType: "package_inbox",
        entityId: id,
        details: {
          zid: body.zid,
          eid: body.eid,
          created: result.result.created,
          updated: result.result.updated,
          skipped: result.result.skipped,
        },
      });
      return result;
    } catch (e) {
      rethrowAsHttp(e, "inbox accept failed");
    }
  }
}
