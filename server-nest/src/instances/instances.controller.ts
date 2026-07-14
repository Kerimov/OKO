import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { getDb } from "../../../server/src/db.js";
import {
  assertInstanceWritable,
  buildEvalSnapshotFromDb,
  deleteInstanceFromDb,
  findInstanceIdByPackageTemplate,
  getInstanceStorageStats,
  listInstanceSummaries,
  loadInstance,
  migratePortalPayloadsToCells,
  patchInstanceCells,
  setInstanceStatus,
  upsertInstance,
  upsertInstancesBatch,
} from "../../../server/src/instances.js";
import {
  submitInstanceWithChecks,
  submitInstancesBulkWithChecks,
  runInstancePeriodChecks,
} from "../../../server/src/instance-submit.js";
import {
  assertOrgInstanceAccess,
  enforceOrgInstanceWrite,
  mergeOrgFilter,
  userZid,
} from "../../../server/src/orgScope.js";
import { loadRashEntries, saveRashEntries } from "../../../server/src/rash-data.js";
import type { RashEntryDto } from "../../../server/src/rash-data.js";
import type { OkoFormInstance } from "../../../server/src/types.js";
import { AdminGuard } from "../auth/admin.guard.js";
import type { OkoRequest } from "../auth/decorators/oko-request.decorator.js";
import { rethrowAsHttp } from "../common/oko-http.js";
import {
  InstanceBulkStatusDto,
  InstanceCellPatchDto,
  InstanceMigrateDto,
  InstanceRashPutDto,
  InstanceRunChecksDto,
  InstanceStatusDto,
} from "./dto/instances.dto.js";

@ApiTags("instances")
@ApiBearerAuth()
@Controller("instances")
export class InstancesController {
  @Get("stats")
  @ApiOperation({ summary: "Статистика хранения экземпляров" })
  async stats() {
    return getInstanceStorageStats(await getDb());
  }

  @Get("eval-snapshot")
  @ApiOperation({ summary: "Снимок данных для движка проверок" })
  async evalSnapshot(@Req() req: Request) {
    const zid = userZid(req);
    return buildEvalSnapshotFromDb(await getDb(), zid ?? undefined);
  }

  @Post("normalize")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Миграция payload → form_cell_values (admin)" })
  async normalize() {
    try {
      const count = await migratePortalPayloadsToCells(await getDb());
      return { migrated: count };
    } catch (e) {
      rethrowAsHttp(e, "normalize failed");
    }
  }

  @Get()
  @ApiOperation({ summary: "Список экземпляров" })
  @ApiQuery({ name: "zid", required: false })
  @ApiQuery({ name: "eid", required: false })
  async list(
    @Req() req: Request,
    @Query("zid") zidRaw?: string,
    @Query("eid") eidRaw?: string
  ) {
    const filter =
      zidRaw != null || eidRaw != null
        ? {
            zid: zidRaw != null ? Number(zidRaw) : undefined,
            eid: eidRaw != null ? Number(eidRaw) : undefined,
          }
        : undefined;
    return listInstanceSummaries(await getDb(), mergeOrgFilter(req, filter));
  }

  @Post("migrate")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Пакетный импорт экземпляров (admin)" })
  async migrate(@Body() body: InstanceMigrateDto) {
    if (body.settings) {
      const db = await getDb();
      const upsert = db.prepare(
        "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      );
      for (const [key, value] of Object.entries(body.settings)) {
        const stored = typeof value === "string" ? value : JSON.stringify(value);
        await upsert.run(key, stored);
      }
    }
    let count = 0;
    const db = await getDb();
    for (const inst of (body.instances ?? []) as unknown as OkoFormInstance[]) {
      await upsertInstance(db, inst);
      count++;
    }
    return { migrated: count };
  }

  @Get(":id")
  @ApiOperation({ summary: "Экземпляр формы по ID" })
  async getOne(@Req() req: Request, @Param("id") id: string) {
    try {
      const inst = await loadInstance(await getDb(), id);
      if (!inst) {
        throw new NotFoundException({ error: "Not found" });
      }
      assertOrgInstanceAccess(req, inst);
      return inst;
    } catch (e) {
      if (e instanceof HttpException) throw e;
      rethrowAsHttp(e, "load instance failed");
    }
  }

  @Post("bulk-status")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Массовая сдача форм (submitted). Sibling-данные пакета грузятся один раз.",
  })
  async bulkStatus(@Req() req: OkoRequest, @Body() body: InstanceBulkStatusDto) {
    if (!Array.isArray(body?.ids) || body.ids.length === 0) {
      throw new BadRequestException({ error: "ids required" });
    }
    if (body.status !== "submitted") {
      throw new BadRequestException({ error: "only status=submitted supported" });
    }
    try {
      const db = await getDb();
      const allowed: string[] = [];
      for (const id of body.ids) {
        const existing = await loadInstance(db, id);
        if (!existing) continue;
        assertOrgInstanceAccess(req, existing);
        if (existing.status === "submitted") {
          allowed.push(id);
          continue;
        }
        await assertInstanceWritable(db, existing, req.apiRole === "admin");
        allowed.push(id);
      }
      return await submitInstancesBulkWithChecks(db, allowed);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      rethrowAsHttp(e, "bulk status update failed");
    }
  }

  @Post("batch")
  @HttpCode(200)
  @ApiOperation({
    summary: "Сохранить несколько экземпляров атомарно (одна транзакция)",
  })
  async batch(
    @Req() req: OkoRequest,
    @Body() body: { instances?: OkoFormInstance[] }
  ) {
    if (!Array.isArray(body?.instances) || body.instances.length === 0) {
      throw new BadRequestException({ error: "instances required" });
    }
    try {
      const scoped = body.instances.map((inst) => {
        const next = enforceOrgInstanceWrite(req, inst);
        if (!next.status) next.status = "draft";
        return next;
      });
      return await upsertInstancesBatch(
        await getDb(),
        scoped,
        req.apiRole === "admin"
      );
    } catch (e) {
      if (e instanceof HttpException) throw e;
      rethrowAsHttp(e, "batch save failed");
    }
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: "Создать / сохранить экземпляр" })
  async create(@Req() req: OkoRequest, @Body() body: OkoFormInstance) {
    try {
      const db = await getDb();
      if (body.instanceId) {
        const existing = await loadInstance(db, body.instanceId);
        if (existing) {
          assertOrgInstanceAccess(req, existing);
          await assertInstanceWritable(db, existing, req.apiRole === "admin");
        }
      }
      const inst = enforceOrgInstanceWrite(req, body);
      if (!inst.status) inst.status = "draft";

      if (inst.zid != null && inst.eid != null) {
        const { assertPeriodWritable } = await import("../../../server/src/periodLifecycle.js");
        await assertPeriodWritable(db, inst.eid, inst.zid);
      }

      // Package scope: only one form per template. If another instance already
      // occupies (zid, eid, template_id), reject with its id instead of opaque DB error.
      if (inst.zid != null && inst.eid != null && inst.templateId) {
        const occupied = await findInstanceIdByPackageTemplate(
          db,
          inst.zid,
          inst.eid,
          inst.templateId
        );
        if (occupied && occupied !== inst.instanceId) {
          throw new ConflictException({
            error: `В комплекте уже есть форма ${inst.templateId}`,
            existingInstanceId: occupied,
            code: "uq_form_instances_package_tpl",
          });
        }
      }

      await upsertInstance(db, inst);
      return inst;
    } catch (e) {
      if (e instanceof HttpException) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (/uq_form_instances_package_tpl/i.test(msg)) {
        throw new ConflictException({
          error: "В комплекте уже есть эта форма (организация + период + шаблон)",
          code: "uq_form_instances_package_tpl",
        });
      }
      rethrowAsHttp(e, "save failed");
    }
  }

  @Put(":id")
  @ApiOperation({ summary: "Обновить экземпляр" })
  async update(
    @Req() req: OkoRequest,
    @Param("id") id: string,
    @Body() body: OkoFormInstance
  ) {
    if (body.instanceId !== id) {
      throw new BadRequestException({ error: "ID mismatch" });
    }
    try {
      const existing = await loadInstance(await getDb(), id);
      if (existing) {
        assertOrgInstanceAccess(req, existing);
        await assertInstanceWritable(await getDb(), existing, req.apiRole === "admin");
      }
      const scoped = enforceOrgInstanceWrite(req, body);
      await upsertInstance(await getDb(), scoped);
      return scoped;
    } catch (e) {
      rethrowAsHttp(e, "save failed");
    }
  }

  @Patch(":id/cells")
  @ApiOperation({ summary: "Пакетное обновление ячеек (без полной перезаписи формы)" })
  async patchCells(
    @Req() req: OkoRequest,
    @Param("id") id: string,
    @Body() body: InstanceCellPatchDto
  ) {
    try {
      const existing = await loadInstance(await getDb(), id);
      if (!existing) throw new NotFoundException({ error: "Not found" });
      assertOrgInstanceAccess(req, existing);
      await assertInstanceWritable(await getDb(), existing, req.apiRole === "admin");
      if (!Array.isArray(body.cells) || body.cells.length === 0) {
        throw new BadRequestException({ error: "cells required" });
      }
      const actor = req.apiUser?.username;
      return await patchInstanceCells(
        await getDb(),
        id,
        body.cells.map((c) => ({
          rowNo: Number(c.rowNo),
          columnKey: String(c.columnKey),
          value: c.value,
        })),
        actor,
        body.expectedRevision
      );
    } catch (e) {
      rethrowAsHttp(e, "patch cells failed");
    }
  }

  @Patch(":id/status")
  @ApiOperation({ summary: "Сменить статус draft / submitted (submitted — после period-проверок)" })
  async patchStatus(
    @Req() req: OkoRequest,
    @Param("id") id: string,
    @Body() body: InstanceStatusDto
  ) {
    const { status } = body;
    try {
      const db = await getDb();
      const existing = await loadInstance(db, id);
      if (!existing) {
        throw new NotFoundException({ error: "Not found" });
      }
      assertOrgInstanceAccess(req, existing);
      await assertInstanceWritable(db, existing, req.apiRole === "admin");
      if (status === "draft" && req.apiRole !== "admin") {
        throw new ForbiddenException({ error: "Only admin can reopen submitted forms" });
      }
      const updated =
        status === "submitted"
          ? await submitInstanceWithChecks(await getDb(), id)
          : await setInstanceStatus(await getDb(), id, status);
      if (!updated) {
        throw new NotFoundException({ error: "Not found" });
      }
      return updated;
    } catch (e) {
      if (e instanceof HttpException) throw e;
      rethrowAsHttp(e, "status update failed");
    }
  }

  @Post(":id/run-checks")
  @HttpCode(200)
  @ApiOperation({ summary: "Dry-run period-проверок (без смены статуса)" })
  async runChecks(
    @Req() req: OkoRequest,
    @Param("id") id: string,
    @Body() body: InstanceRunChecksDto = {}
  ) {
    try {
      const existing = await loadInstance(await getDb(), id);
      if (!existing) {
        throw new NotFoundException({ error: "Not found" });
      }
      assertOrgInstanceAccess(req, existing);
      const ran = await runInstancePeriodChecks(
        await getDb(),
        id,
        body.mode ?? "period"
      );
      if (!ran) {
        throw new NotFoundException({ error: "Not found" });
      }
      return ran.result;
    } catch (e) {
      if (e instanceof HttpException) throw e;
      rethrowAsHttp(e, "run-checks failed");
    }
  }

  @Delete(":id")
  @ApiOperation({ summary: "Удалить экземпляр" })
  async remove(@Req() req: Request, @Param("id") id: string) {
    try {
      const existing = await loadInstance(await getDb(), id);
      if (existing) assertOrgInstanceAccess(req, existing);
      await deleteInstanceFromDb(await getDb(), id);
      return { ok: true as const };
    } catch (e) {
      rethrowAsHttp(e, "delete failed");
    }
  }

  @Get(":id/rash")
  @ApiOperation({ summary: "Записи расшифровки экземпляра" })
  @ApiQuery({ name: "formId", required: false })
  async getRash(
    @Req() req: Request,
    @Param("id") id: string,
    @Query("formId") formIdQuery?: string
  ) {
    const db = await getDb();
    const existing = await loadInstance(db, id);
    if (!existing) {
      throw new NotFoundException({ error: "Not found" });
    }
    try {
      assertOrgInstanceAccess(req, existing);
    } catch (e) {
      rethrowAsHttp(e);
    }
    const formId = String(formIdQuery ?? existing.templateId).trim();
    const entries = await loadRashEntries(db, id, formId || undefined);
    return { entries };
  }

  @Put(":id/rash")
  @ApiOperation({ summary: "Сохранить расшифровку экземпляра" })
  async putRash(
    @Req() req: OkoRequest,
    @Param("id") id: string,
    @Body() body: InstanceRashPutDto
  ) {
    const db = await getDb();
    const existing = await loadInstance(db, id);
    if (!existing) {
      throw new NotFoundException({ error: "Not found" });
    }
    try {
      assertOrgInstanceAccess(req, existing);
      await assertInstanceWritable(db, existing, req.apiRole === "admin");
    } catch (e) {
      rethrowAsHttp(e);
    }
    const formId = String(body.formId ?? existing.templateId).trim();
    if (!formId) {
      throw new BadRequestException({ error: "formId required" });
    }
    const entries = await saveRashEntries(
      db,
      id,
      formId,
      (body.entries ?? []) as unknown as RashEntryDto[]
    );
    return { entries };
  }
}
