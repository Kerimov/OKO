import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
} from "../../../server/src/packages.js";
import {
  assertOrgZidParam,
} from "../../../server/src/orgScope.js";
import { AdminGuard } from "../auth/admin.guard.js";
import { rethrowAsHttp } from "../common/oko-http.js";
import { PackageImportDto, PackageZidEidDto } from "./dto/packages.dto.js";
import { assertPackageSubmittedChecks } from "../../../server/src/instance-submit.js";
import type { OkoFormInstance } from "../../../server/src/types.js";

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
      const instances = body.package.instances as OkoFormInstance[];
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
        body.overwrite === true
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
