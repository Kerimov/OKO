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
  deleteAggEntry,
  exportAggPayload,
  getAggStats,
  listAggEntries,
  reimportAggFromJson,
  runPackageAggregation,
  upsertAggEntry,
} from "../../../server/src/aggregation.js";
import { getDb } from "../../../server/src/db.js";
import { assertOrgZidParam } from "../../../server/src/orgScope.js";
import { AdminGuard } from "../auth/admin.guard.js";
import { rethrowAsHttp } from "../common/oko-http.js";
import { AggListUpsertDto, RunAggregationDto } from "./dto/aggregation.dto.js";

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

  @Post("run")
  @ApiOperation({ summary: "Свести комплект по a_tblAgg_List" })
  async run(@Req() req: Request, @Body() body: RunAggregationDto) {
    if (!body.parentZid || !body.eid) {
      throw new BadRequestException({ error: "parentZid and eid required" });
    }
    try {
      assertOrgZidParam(req, body.parentZid);
      return runPackageAggregation(await getDb(), body.parentZid, body.eid);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      rethrowAsHttp(e, "aggregation failed");
    }
  }
}
