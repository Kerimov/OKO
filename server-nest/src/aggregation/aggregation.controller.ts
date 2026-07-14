import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import {
  checkPackageRelationsAccRows,
  createCorrectReorg,
  deleteAggEntry,
  deleteCorrSet,
  exportAggPayload,
  fillPackageBalanceRows,
  getAggStats,
  listAggEntries,
  listCorrSets,
  previewPackageAggregation,
  reimportAggFromJson,
  runPackageAggregation,
  upsertAggEntry,
  validatePackageAccountRows,
} from "../../../server/src/aggregation.js";
import { getDb } from "../../../server/src/db.js";
import { logDomainAudit } from "../../../server/src/audit.js";
import {
  assertAggregationTargetZid,
  assertOrgZidParam,
} from "../../../server/src/orgScope.js";
import { AdminGuard } from "../auth/admin.guard.js";
import { rethrowAsHttp } from "../common/oko-http.js";
import {
  AggListUpsertDto,
  CreateCorrSetDto,
  FillBalanceRowsDto,
  RunAggregationDto,
  ValidateAccountRowsDto,
} from "./dto/aggregation.dto.js";

async function assertAggTarget(req: Request, parentZid: number, targetZid?: number | null) {
  const db = await getDb();
  const sets = await listCorrSets(db, parentZid);
  assertAggregationTargetZid(
    req,
    parentZid,
    targetZid,
    sets.map((s) => s.corrZid)
  );
}

@ApiTags("aggregation")
@ApiBearerAuth()
@Controller("aggregation")
export class AggregationController {
  @Get("stats")
  @ApiOperation({ summary: "Статистика правил агрегации" })
  async stats() {
    return getAggStats(await getDb());
  }

  @Get("export")
  @ApiOperation({ summary: "Экспорт a_tblAgg_List" })
  async exportAll() {
    return exportAggPayload(await getDb());
  }

  @Post("reimport")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Перезагрузить agg-list.json (admin)" })
  async reimport() {
    try {
      const count = await reimportAggFromJson(await getDb());
      return { reimported: count };
    } catch (e) {
      throw new InternalServerErrorException({
        error: e instanceof Error ? e.message : "reimport failed",
      });
    }
  }

  @Get("list")
  @ApiOperation({ summary: "Список правил агрегации" })
  @ApiQuery({ name: "parentZid", required: false })
  async list(@Query("parentZid") parentZidRaw?: string) {
    const parentZid = parentZidRaw != null ? Number(parentZidRaw) : undefined;
    return listAggEntries(await getDb(), parentZid);
  }

  @Post("list")
  @UseGuards(AdminGuard)
  @HttpCode(201)
  @ApiOperation({ summary: "Добавить правило агрегации (admin)" })
  async createListEntry(@Body() body: AggListUpsertDto) {
    if (!body.parentZid || !body.childZid) {
      throw new BadRequestException({ error: "parentZid and childZid required" });
    }
    try {
      return upsertAggEntry(await getDb(), body);
    } catch (e) {
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "create failed",
      });
    }
  }

  @Put("list/:id")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Обновить правило агрегации (admin)" })
  async updateListEntry(@Param("id") idRaw: string, @Body() body: AggListUpsertDto) {
    const id = Number(idRaw);
    if (!Number.isFinite(id) || !body.parentZid || !body.childZid) {
      throw new BadRequestException({ error: "invalid id or missing zids" });
    }
    try {
      return upsertAggEntry(await getDb(), { id, ...body });
    } catch (e) {
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "update failed",
      });
    }
  }

  @Delete("list/:id")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Удалить правило агрегации (admin)" })
  async deleteListEntry(@Param("id") idRaw: string) {
    const id = Number(idRaw);
    if (!Number.isFinite(id)) {
      throw new BadRequestException({ error: "invalid id" });
    }
    const ok = await deleteAggEntry(await getDb(), id);
    if (!ok) {
      throw new NotFoundException({ error: "Not found" });
    }
    return { ok: true as const };
  }

  @Get("corr-sets")
  @ApiOperation({ summary: "Корректирующие наборы (CreateCorrectReorg) у сводной организации" })
  @ApiQuery({ name: "parentZid", required: true })
  async corrSets(@Req() req: Request, @Query("parentZid") parentZidRaw?: string) {
    const parentZid = Number(parentZidRaw);
    if (!Number.isFinite(parentZid)) {
      throw new BadRequestException({ error: "parentZid required" });
    }
    assertOrgZidParam(req, parentZid);
    return listCorrSets(await getDb(), parentZid);
  }

  @Post("corr-sets")
  @UseGuards(AdminGuard)
  @HttpCode(201)
  @ApiOperation({ summary: "Создать корректирующий набор / зеркало (CreateCorrectReorg)" })
  async createCorr(@Req() req: Request, @Body() body: CreateCorrSetDto) {
    if (!body.parentZid || !body.eid) {
      throw new BadRequestException({ error: "parentZid and eid required" });
    }
    try {
      assertOrgZidParam(req, body.parentZid);
      return createCorrectReorg(await getDb(), body);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      rethrowAsHttp(e, "create corr set failed");
    }
  }

  @Delete("corr-sets/:id")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Удалить регистрацию корректирующего набора (орг. не удаляется)" })
  async removeCorr(@Param("id") idRaw: string) {
    const id = Number(idRaw);
    if (!Number.isFinite(id)) throw new BadRequestException({ error: "invalid id" });
    const ok = await deleteCorrSet(await getDb(), id);
    if (!ok) throw new NotFoundException({ error: "Not found" });
    return { ok: true as const };
  }

  @Post("account-rows")
  @ApiOperation({
    summary: "AggrSetAccount: проверка соответствия счетов N01_01/02 и строк N01_1",
  })
  async accountRows(@Req() req: Request, @Body() body: ValidateAccountRowsDto) {
    if (!body.parentZid || !body.eid) {
      throw new BadRequestException({ error: "parentZid and eid required" });
    }
    try {
      await assertAggTarget(req, body.parentZid, body.targetZid);
      const forms = body.forms?.filter(
        (f): f is "N01_01" | "N01_02" => f === "N01_01" || f === "N01_02"
      );
      return validatePackageAccountRows(await getDb(), {
        parentZid: body.parentZid,
        eid: body.eid,
        targetZid: body.targetZid,
        forms,
      });
    } catch (e) {
      if (e instanceof HttpException) throw e;
      rethrowAsHttp(e, "account-rows validation failed");
    }
  }

  @Post("account-rows/relations")
  @ApiOperation({
    summary: "CheckRelationsAccRows: суммы N01_02 по Стр. vs N01_1.H",
  })
  async accountRelations(@Req() req: Request, @Body() body: ValidateAccountRowsDto) {
    if (!body.parentZid || !body.eid) {
      throw new BadRequestException({ error: "parentZid and eid required" });
    }
    try {
      await assertAggTarget(req, body.parentZid, body.targetZid);
      return checkPackageRelationsAccRows(await getDb(), {
        parentZid: body.parentZid,
        eid: body.eid,
        targetZid: body.targetZid,
      });
    } catch (e) {
      if (e instanceof HttpException) throw e;
      rethrowAsHttp(e, "account-rows relations failed");
    }
  }

  @Post("account-rows/fill-balance")
  @ApiOperation({
    summary: "FillBalanceRows: заполнить N01_1.H из N01_02",
  })
  async fillBalance(@Req() req: Request, @Body() body: FillBalanceRowsDto) {
    if (!body.parentZid || !body.eid) {
      throw new BadRequestException({ error: "parentZid and eid required" });
    }
    try {
      await assertAggTarget(req, body.parentZid, body.targetZid);
      return fillPackageBalanceRows(await getDb(), {
        parentZid: body.parentZid,
        eid: body.eid,
        targetZid: body.targetZid,
        mode: body.mode,
        overwriteSubmitted: body.overwriteSubmitted,
      });
    } catch (e) {
      if (e instanceof HttpException) throw e;
      rethrowAsHttp(e, "fill-balance failed");
    }
  }

  @Post("preview")
  @ApiOperation({ summary: "Превью готовности свода (матрица форм × участников)" })
  async preview(@Req() req: Request, @Body() body: RunAggregationDto) {
    if (!body.parentZid || !body.eid) {
      throw new BadRequestException({ error: "parentZid and eid required" });
    }
    try {
      await assertAggTarget(req, body.parentZid, body.targetZid);
      return previewPackageAggregation(await getDb(), {
        parentZid: body.parentZid,
        eid: body.eid,
        childZids: body.childZids,
        formIds: body.formIds,
        requireAllChildren: body.requireAllChildren,
        colorMode: body.colorMode,
        reorg: body.reorg,
        updateCorrSet: body.updateCorrSet,
        targetZid: body.targetZid,
        includeDraftSources: body.includeDraftSources,
        overwriteSubmitted: body.overwriteSubmitted,
      });
    } catch (e) {
      if (e instanceof HttpException) throw e;
      rethrowAsHttp(e, "aggregation preview failed");
    }
  }

  @Post("run")
  @ApiOperation({
    summary: "Свести комплект (AggregateSet / AggrSetReorg* / AggrGreenUpdate / k_zid)",
  })
  async run(@Req() req: Request, @Body() body: RunAggregationDto) {
    if (!body.parentZid || !body.eid) {
      throw new BadRequestException({ error: "parentZid and eid required" });
    }
    try {
      await assertAggTarget(req, body.parentZid, body.targetZid);
      const db = await getDb();
      const actor =
        (req as { apiUser?: { username?: string }; apiRole?: string }).apiUser?.username ??
        (req as { apiRole?: string }).apiRole ??
        "unknown";
      const result = await runPackageAggregation(db, {
        parentZid: body.parentZid,
        eid: body.eid,
        childZids: body.childZids,
        formIds: body.formIds,
        requireAllChildren: body.requireAllChildren,
        recalc: body.recalc,
        colorMode: body.colorMode,
        reorg: body.reorg,
        updateCorrSet: body.updateCorrSet,
        targetZid: body.targetZid,
        includeDraftSources: body.includeDraftSources,
        overwriteSubmitted: body.overwriteSubmitted,
        lockedBy: actor,
      });
      await logDomainAudit(db, {
        actor,
        action: "aggregation.run",
        entityType: "package",
        entityId: `${body.parentZid}:${body.eid}`,
        details: {
          parentZid: body.parentZid,
          eid: body.eid,
          targetZid: body.targetZid ?? body.parentZid,
          aggregated: result.aggregated,
          skipped: result.skipped,
          includeDraftSources: !!body.includeDraftSources,
          overwriteSubmitted: !!body.overwriteSubmitted,
        },
      });
      return result;
    } catch (e) {
      if (e instanceof HttpException) throw e;
      rethrowAsHttp(e, "aggregation failed");
    }
  }
}
