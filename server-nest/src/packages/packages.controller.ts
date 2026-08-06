import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { getDb } from "../../../server/src/db.js";
import {
  createReportPackage,
  constructPackages,
  deleteReportPackage,
  deleteReportPackagesBulk,
  exportReportPackagesBulk,
  getPackageCompleteness,
  getPackagesDashboard,
  getPackageWorkspace,
  getPackageWorkspaceDetail,
  importReportPackage,
  listPackageCampaigns,
  previewPackageConstruction,
} from "../../../server/src/packages.js";
import {
  enqueueBackgroundJob,
  getBackgroundJob,
} from "../../../server/src/jobs.js";
import {
  assertOrgZidParam,
  userZid,
} from "../../../server/src/orgScope.js";
import { AdminGuard } from "../auth/admin.guard.js";
import { rethrowAsHttp } from "../common/oko-http.js";
import {
  PackageBulkDeleteDto,
  PackageBulkExportDto,
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
  @Get("workspace/campaigns")
  @ApiOperation({ summary: "Агрегаты кампаний (период × вид) для сайдбара" })
  @ApiQuery({ name: "zid", required: false })
  @ApiQuery({ name: "packageKind", required: false })
  @ApiQuery({ name: "q", required: false })
  async workspaceCampaigns(
    @Req() req: Request,
    @Query("zid") zidRaw?: string,
    @Query("packageKind") packageKind?: string,
    @Query("q") q?: string
  ) {
    try {
      const scoped = userZid(req);
      let zid: number | undefined;
      if (scoped != null) zid = scoped;
      else if (zidRaw != null && zidRaw !== "") {
        zid = Number(zidRaw);
        if (!Number.isFinite(zid)) {
          throw new BadRequestException({ error: "invalid zid" });
        }
      }
      return listPackageCampaigns(await getDb(), {
        zid,
        packageKind:
          packageKind === "BALANCE"
            ? "BALANCE"
            : packageKind === "OKO"
              ? "OKO"
              : undefined,
        q: q?.trim() || undefined,
      });
    } catch (e) {
      if (e instanceof HttpException) throw e;
      rethrowAsHttp(e, "workspace campaigns failed");
    }
  }

  @Get("workspace")
  @ApiOperation({
    summary: "Рабочий список комплектов (фильтр по кампании / орг / поиск)",
  })
  @ApiQuery({ name: "zid", required: false })
  @ApiQuery({ name: "periodName", required: false })
  @ApiQuery({ name: "packageKind", required: false })
  @ApiQuery({ name: "q", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiQuery({ name: "offset", required: false })
  async workspace(
    @Req() req: Request,
    @Query("zid") zidRaw?: string,
    @Query("periodName") periodName?: string,
    @Query("packageKind") packageKind?: string,
    @Query("q") q?: string,
    @Query("limit") limitRaw?: string,
    @Query("offset") offsetRaw?: string
  ) {
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
      const limit =
        limitRaw != null && limitRaw !== "" ? Number(limitRaw) : undefined;
      const offset =
        offsetRaw != null && offsetRaw !== "" ? Number(offsetRaw) : undefined;
      return getPackageWorkspace(await getDb(), {
        zid,
        periodName: periodName?.trim() || undefined,
        packageKind:
          packageKind === "BALANCE"
            ? "BALANCE"
            : packageKind === "OKO"
              ? "OKO"
              : undefined,
        q: q?.trim() || undefined,
        limit: Number.isFinite(limit) ? limit : undefined,
        offset: Number.isFinite(offset) ? offset : undefined,
      });
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

  @Post("construct-async")
  @HttpCode(202)
  @ApiOperation({ summary: "Массовое создание комплектов в фоне (job)" })
  async constructAsync(@Req() req: Request, @Body() body: PackageConstructDto) {
    try {
      assertConstructAccess(req, body);
      const targets = Array.isArray(body.targets) ? body.targets.length : 0;
      const job = await enqueueBackgroundJob(await getDb(), {
        type: "construct_packages",
        payload: body as unknown as Record<string, unknown>,
        createdBy: req.apiUser?.username ?? req.apiRole ?? null,
        message: targets > 1 ? `Очередь: ${targets} орг.` : "Очередь создания комплектов",
      });
      return { jobId: job.id, status: job.status };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      rethrowAsHttp(e, "construct-async failed");
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

  @Post("create-async")
  @HttpCode(202)
  @ApiOperation({ summary: "Поставить создание комплекта в очередь (job)" })
  async createAsync(@Req() req: Request, @Body() body: PackageZidEidDto) {
    if (!body.zid || !body.eid) {
      throw new BadRequestException({ error: "zid and eid required" });
    }
    try {
      assertOrgZidParam(req, body.zid);
      const job = await enqueueBackgroundJob(await getDb(), {
        type: "create_report_package",
        payload: { zid: body.zid, eid: body.eid },
        createdBy: req.apiUser?.username ?? req.apiRole ?? null,
        message: "Создание комплекта в очереди",
      });
      return { jobId: job.id, status: job.status };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "enqueue failed",
      });
    }
  }

  @Get("jobs/:id")
  @ApiOperation({ summary: "Статус фоновой задачи (создание комплекта и др.)" })
  async jobStatus(@Req() req: Request, @Param("id") id: string) {
    const job = await getBackgroundJob(await getDb(), id);
    if (!job) {
      throw new NotFoundException({ error: "job not found" });
    }
    const zid = Number(job.payload.zid);
    if (Number.isFinite(zid)) {
      assertOrgZidParam(req, zid);
    }
    return job;
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
  @ApiOperation({ summary: "Массовое удаление комплектов (sync, ≤500)" })
  async bulkDelete(@Req() req: Request, @Body() body: PackageBulkDeleteDto) {
    const rawItems = Array.isArray(body?.items) ? body.items : [];
    const items = rawItems
      .map((item) => ({
        zid: Number(item?.zid),
        eid: Number(item?.eid),
      }))
      .filter(
        (item) =>
          Number.isFinite(item.zid) &&
          Number.isFinite(item.eid) &&
          item.zid > 0 &&
          item.eid > 0
      );
    if (!items.length) {
      throw new BadRequestException({
        error: "items required",
        message: "Укажите комплекты для очистки (zid + eid)",
      });
    }
    try {
      for (const item of items) {
        assertOrgZidParam(req, item.zid);
      }
      return await deleteReportPackagesBulk(await getDb(), items);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      rethrowAsHttp(e, "bulk delete failed");
    }
  }

  @Post("bulk-delete-async")
  @HttpCode(202)
  @ApiOperation({ summary: "Массовое удаление комплектов в фоне (job)" })
  async bulkDeleteAsync(@Req() req: Request, @Body() body: PackageBulkDeleteDto) {
    const rawItems = Array.isArray(body?.items) ? body.items : [];
    const items = rawItems
      .map((item) => ({
        zid: Number(item?.zid),
        eid: Number(item?.eid),
      }))
      .filter(
        (item) =>
          Number.isFinite(item.zid) &&
          Number.isFinite(item.eid) &&
          item.zid > 0 &&
          item.eid > 0
      );
    if (!items.length) {
      throw new BadRequestException({
        error: "items required",
        message: "Укажите комплекты для удаления (zid + eid)",
      });
    }
    try {
      for (const item of items) {
        assertOrgZidParam(req, item.zid);
      }
      const job = await enqueueBackgroundJob(await getDb(), {
        type: "delete_packages",
        payload: { items },
        createdBy: req.apiUser?.username ?? req.apiRole ?? null,
        message: `Очередь удаления: ${items.length} компл.`,
      });
      return { jobId: job.id, status: job.status };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      rethrowAsHttp(e, "bulk-delete-async failed");
    }
  }

  @Post("export/bulk")
  @ApiOperation({ summary: "Массовая выгрузка комплектов одним ZIP (manifest.json + JSON по org)" })
  async exportBulk(
    @Req() req: Request,
    @Body() body: PackageBulkExportDto,
    @Res() res: Response
  ) {
    const items = body.items ?? [];
    if (!items.length) {
      throw new BadRequestException({ error: "items required" });
    }
    try {
      for (const item of items) {
        assertOrgZidParam(req, Number(item.zid));
      }
      const result = await exportReportPackagesBulk(await getDb(), items);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${result.filename}"`
      );
      res.setHeader("X-Packages-Exported", String(result.exported));
      res.setHeader("X-Packages-Failed", String(result.failed));
      res.send(Buffer.from(result.zip));
    } catch (e) {
      if (e instanceof HttpException) throw e;
      rethrowAsHttp(e, "bulk export failed");
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
