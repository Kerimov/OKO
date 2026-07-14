import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { getDb } from "../../../server/src/db.js";
import {
  createReportPackage,
  deleteReportPackage,
  getPackageCompleteness,
  getPackagesDashboard,
  importReportPackage,
  setPackageWorkflow,
  type PackageWorkflowStatus,
} from "../../../server/src/packages.js";
import {
  assertOrgZidParam,
} from "../../../server/src/orgScope.js";
import { AdminGuard } from "../auth/admin.guard.js";
import { rethrowAsHttp } from "../common/oko-http.js";
import { PackageImportDto, PackageWorkflowPutDto, PackageZidEidDto } from "./dto/packages.dto.js";
import { assertPackageSubmittedChecks } from "../../../server/src/instance-submit.js";
import type { OkoFormInstance } from "../../../server/src/types.js";
import type { OkoRequest } from "../auth/decorators/oko-request.decorator.js";

@ApiTags("packages")
@ApiBearerAuth()
@Controller("packages")
export class PackagesController {
  @Get("completeness")
  @ApiOperation({ summary: "Полнота комплекта (76 форм)" })
  @ApiQuery({ name: "zid", required: true })
  @ApiQuery({ name: "eid", required: true })
  async completeness(@Req() req: Request, @Query("zid") zidRaw: string, @Query("eid") eidRaw: string) {
    const zid = Number(zidRaw);
    const eid = Number(eidRaw);
    if (!Number.isFinite(zid) || !Number.isFinite(eid)) {
      throw new BadRequestException({ error: "zid and eid required" });
    }
    try {
      assertOrgZidParam(req, zid);
      return getPackageCompleteness(await getDb(), zid, eid);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      rethrowAsHttp(e, "failed");
    }
  }

  @Post("workflow")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Сменить статус комплекта (draft→submitted→returned/accepted; corrected→submitted)",
  })
  async setWorkflow(@Req() req: OkoRequest, @Body() body: PackageWorkflowPutDto) {
    if (!body.zid || !body.eid || !body.status) {
      throw new BadRequestException("zid, eid and status required");
    }
    try {
      assertOrgZidParam(req, body.zid);
      return await setPackageWorkflow(await getDb(), body.zid, body.eid, {
        status: body.status as PackageWorkflowStatus,
        comment: body.comment ?? null,
        actor: req.apiUser?.username ?? req.apiRole ?? null,
        isAdmin: req.apiRole === "admin",
        force: body.force === true && req.apiRole === "admin",
      });
    } catch (e) {
      if (e instanceof HttpException) throw e;
      const msg = e instanceof Error ? e.message : "workflow update failed";
      const status = (e as Error & { status?: number }).status;
      if (status === 403) {
        throw new ForbiddenException(msg);
      }
      if (
        status === 400 ||
        /неполон|не все|недопустимый|закрыт|нельзя принять|period is closed/i.test(msg)
      ) {
        throw new BadRequestException(msg);
      }
      console.error("[packages/workflow]", msg, e);
      rethrowAsHttp(e, "workflow update failed");
    }
  }

  @Post("create")
  @HttpCode(201)
  @ApiOperation({ summary: "Создать комплект (76 пустых форм)" })
  async create(@Req() req: Request, @Body() body: PackageZidEidDto) {
    if (!body.zid || !body.eid) {
      throw new BadRequestException({ error: "zid and eid required" });
    }
    try {
      assertOrgZidParam(req, body.zid);
      return createReportPackage(await getDb(), body.zid, body.eid);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "create failed",
      });
    }
  }

  @Delete()
  @ApiOperation({ summary: "Удалить комплект ZID+EID" })
  @ApiQuery({ name: "zid", required: true })
  @ApiQuery({ name: "eid", required: true })
  async remove(@Req() req: Request, @Query("zid") zidRaw: string, @Query("eid") eidRaw: string) {
    const zid = Number(zidRaw);
    const eid = Number(eidRaw);
    if (!Number.isFinite(zid) || !Number.isFinite(eid)) {
      throw new BadRequestException({ error: "zid and eid required" });
    }
    try {
      assertOrgZidParam(req, zid);
      return deleteReportPackage(await getDb(), zid, eid);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "delete failed",
      });
    }
  }

  @Post("import")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Импорт ReportPackage (admin); submitted → period-проверки" })
  async importPackage(@Body() body: PackageImportDto) {
    if (!body.zid || !body.eid) {
      throw new BadRequestException({ error: "zid and eid required" });
    }
    if (!body.package?.instances?.length) {
      throw new BadRequestException({ error: "package.instances required" });
    }
    try {
      let instances = body.package.instances as OkoFormInstance[];
      if (body.templateIds?.length) {
        const allow = new Set(body.templateIds);
        instances = instances.filter((i) => i.templateId && allow.has(i.templateId));
      }
      if (!instances.length) {
        throw new BadRequestException({ error: "no instances to import after templateIds filter" });
      }
      await assertPackageSubmittedChecks(await getDb(), instances);
      return importReportPackage(
        await getDb(),
        body.zid,
        body.eid,
        {
          organization: body.package.organization,
          periodStart: body.package.periodStart,
          periodEnd: body.package.periodEnd,
          instances,
        },
        body.overwrite === true,
        body.templateIds
      );
    } catch (e) {
      if (e instanceof HttpException) throw e;
      rethrowAsHttp(e, "import failed");
    }
  }

  @Get("dashboard")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Дашборд комплектов всех организаций (admin)" })
  async dashboard() {
    return getPackagesDashboard(await getDb());
  }
}
