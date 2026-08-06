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
  constructPackages,
  deleteReportPackage,
  deleteReportPackagesBulk,
  getPackageCompleteness,
  getPackagesDashboard,
  getPackageWorkspace,
  getPackageWorkspaceDetail,
  importReportPackage,
  previewPackageConstruction,
} from "../../../server/src/packages.js";
import {
  assertOrgZidParam,
  userZid,
} from "../../../server/src/orgScope.js";
import { AdminGuard } from "../auth/admin.guard.js";
import { rethrowAsHttp } from "../common/oko-http.js";
import {
  PackageBulkDeleteDto,
  PackageConstructDto,
  PackageImportDto,
  PackageZidEidDto,
} from "./dto/packages.dto.js";
import { assertPackageSubmittedChecks } from "../../../server/src/instance-submit.js";
import type { OkoFormInstance } from "../../../server/src/types.js";

function assertConstructAccess(req: Request, body: PackageConstructDto): void {
  const scoped = userZid(req);
  if (scoped == null) return; // admin
  if (body.mode === "bulk") {
    throw new ForbiddenException({ error: "Массовое создание доступно только администратору" });
  }
  const targets = body.targets ?? [];
  if (targets.length !== 1 || Number(targets[0]?.zid) !== scoped) {
    throw new ForbiddenException({ error: "Можно создавать комплект только для своей организации" });
  }
}

@ApiTags("packages")
@ApiBearerAuth()
@Controller("packages")
export class PackagesController {
  @Get("workspace")
  @ApiOperation({ summary: "Рабочий список комплектов (орг × период + БП + прогресс)" })
  @ApiQuery({ name: "zid", required: false })
  async workspace(@Req() req: Request, @Query("zid") zidRaw?: string) {
    try {
      const scoped = userZid(req);
      let zid: number | undefined;
      if (scoped != null) {
        zid = scoped;
      } else if (zidRaw != null && zidRaw !== "") {
        zid = Number(zidRaw);
        if (!Number.isFinite(zid)) {
          throw new BadRequestException({ error: "invalid zid" });
        }
      }
      return getPackageWorkspace(await getDb(), zid != null ? { zid } : undefined);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      rethrowAsHttp(e, "workspace failed");
    }
  }

  @Get("workspace/detail")
  @ApiOperation({ summary: "Карточка комплекта: полнота, БП, блокеры" })
  @ApiQuery({ name: "zid", required: true })
  @ApiQuery({ name: "eid", required: true })
  @ApiQuery({ name: "packageKind", required: false })
  async workspaceDetail(
    @Req() req: Request,
    @Query("zid") zidRaw: string,
    @Query("eid") eidRaw: string,
    @Query("packageKind") packageKind?: string
  ) {
    const zid = Number(zidRaw);
    const eid = Number(eidRaw);
    if (!Number.isFinite(zid) || !Number.isFinite(eid)) {
      throw new BadRequestException({ error: "zid and eid required" });
    }
    try {
      assertOrgZidParam(req, zid);
      const detail = await getPackageWorkspaceDetail(
        await getDb(),
        zid,
        eid,
        packageKind === "BALANCE" ? "BALANCE" : packageKind === "OKO" ? "OKO" : undefined
      );
      if (!detail) {
        throw new BadRequestException({ error: "Package not found" });
      }
      return detail;
    } catch (e) {
      if (e instanceof HttpException) throw e;
      rethrowAsHttp(e, "workspace detail failed");
    }
  }

  @Post("construct/preview")
  @HttpCode(200)
  @ApiOperation({ summary: "Предпросмотр конструктора комплектов" })
  async constructPreview(@Req() req: Request, @Body() body: PackageConstructDto) {
    try {
      assertConstructAccess(req, body);
      return previewPackageConstruction(await getDb(), body);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      rethrowAsHttp(e, "construct preview failed");
    }
  }

  @Post("construct")
  @HttpCode(200)
  @ApiOperation({ summary: "Создать комплекты (один или массово)" })
  async construct(@Req() req: Request, @Body() body: PackageConstructDto) {
    try {
      assertConstructAccess(req, body);
      return constructPackages(await getDb(), body);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      rethrowAsHttp(e, "construct failed");
    }
  }

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

  @Post("bulk-delete")
  @HttpCode(200)
  @ApiOperation({ summary: "Массовое удаление комплектов" })
  async bulkDelete(@Req() req: Request, @Body() body: PackageBulkDeleteDto) {
    const items = body.items ?? [];
    if (!items.length) {
      throw new BadRequestException({ error: "items required" });
    }
    try {
      for (const item of items) {
        assertOrgZidParam(req, Number(item.zid));
      }
      return deleteReportPackagesBulk(await getDb(), items);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      rethrowAsHttp(e, "bulk delete failed");
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
