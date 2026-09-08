import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { getDb } from "../../../domain/src/db.js";
import {
  createExcelMapping,
  deleteExcelMapping,
  exportExcelPayload,
  getExcelMapping,
  getExcelStats,
  listExcelMappings,
  reimportExcelMappingsFromJson,
  updateExcelMapping,
  type ExcelMappingDto,
} from "../../../domain/src/excel.js";
import { AdminGuard } from "../auth/admin.guard.js";

@ApiTags("excel")
@ApiBearerAuth()
@Controller("excel")
export class ExcelController {
  @Get("stats")
  @ApiOperation({ summary: "Статистика Excel-маппингов" })
  async stats() {
    return getExcelStats(await getDb());
  }

  @Get("export")
  @ApiOperation({ summary: "Экспорт excel-export.json payload" })
  async exportAll() {
    return exportExcelPayload(await getDb());
  }

  @Get()
  @ApiOperation({ summary: "Список Excel-маппингов (пагинация)" })
  @ApiQuery({ name: "limit", required: false })
  @ApiQuery({ name: "offset", required: false })
  @ApiQuery({ name: "q", required: false })
  @ApiQuery({ name: "formName", required: false })
  async list(
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
    @Query("q") q?: string,
    @Query("formName") formName?: string
  ) {
    return listExcelMappings(await getDb(), {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      q,
      formName,
    });
  }

  @Get(":id")
  @ApiOperation({ summary: "Excel-маппинг по id" })
  async getOne(@Param("id") idRaw: string) {
    const item = await getExcelMapping(await getDb(), Number(idRaw));
    if (!item) throw new NotFoundException({ error: "Not found" });
    return item;
  }

  @Post()
  @UseGuards(AdminGuard)
  @HttpCode(201)
  @ApiOperation({ summary: "Создать Excel-маппинг (admin)" })
  async create(@Body() dto: ExcelMappingDto) {
    if (!dto.formName?.trim()) throw new BadRequestException({ error: "formName required" });
    try {
      return await createExcelMapping(await getDb(), dto);
    } catch (e) {
      throw new InternalServerErrorException({
        error: e instanceof Error ? e.message : "insert failed",
      });
    }
  }

  @Put(":id")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Обновить Excel-маппинг (admin)" })
  async update(@Param("id") idRaw: string, @Body() dto: ExcelMappingDto) {
    const updated = await updateExcelMapping(await getDb(), Number(idRaw), dto);
    if (!updated) throw new NotFoundException({ error: "Not found" });
    return updated;
  }

  @Delete(":id")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Удалить Excel-маппинг (admin)" })
  async remove(@Param("id") idRaw: string) {
    const ok = await deleteExcelMapping(await getDb(), Number(idRaw));
    if (!ok) throw new NotFoundException({ error: "Not found" });
    return { ok: true as const };
  }

  @Post("reimport")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Перезагрузить excel-export.json (admin)" })
  async reimport() {
    try {
      const count = await reimportExcelMappingsFromJson(await getDb());
      return { reimported: count };
    } catch (e) {
      throw new InternalServerErrorException({
        error: e instanceof Error ? e.message : "reimport failed",
      });
    }
  }
}
