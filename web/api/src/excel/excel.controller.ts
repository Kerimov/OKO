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
import { getDb } from "../../../server/src/db.js";
import {
  createExcelMapping,
  deleteExcelMapping,
  exportExcelPayload,
  getExcelMapping,
  getExcelStats,
  reimportExcelMappingsFromJson,
  rowToDto as excelRowToDto,
  updateExcelMapping,
  type ExcelMappingDto,
  type ExcelMappingRow,
} from "../../../server/src/excel.js";
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
    @Query("limit") limitRaw?: string,
    @Query("offset") offsetRaw?: string,
    @Query("q") qRaw?: string,
    @Query("formName") formNameRaw?: string
  ) {
    const db = await getDb();
    const limit = Math.min(Number(limitRaw) || 50, 500);
    const offset = Number(offsetRaw) || 0;
    const q = String(qRaw ?? "").trim();
    const formName = String(formNameRaw ?? "").trim();

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (q) {
      conditions.push(
        "(form_name LIKE ? OR sheet_name LIKE ? OR form_column LIKE ? OR CAST(excel_row AS TEXT) LIKE ?)"
      );
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    if (formName) {
      conditions.push("form_name = ?");
      params.push(formName);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = (
      (await db.prepare(`SELECT COUNT(*) AS c FROM excel_mappings ${where}`).get(...params)) as {
        c: number;
      }
    ).c;

    const rows = (await db
      .prepare(
        `SELECT id, form_name, sheet_name, excel_row, excel_column,
                form_column, form_row, period, add_text
         FROM excel_mappings ${where}
         ORDER BY form_name, id
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset)) as ExcelMappingRow[];

    return { total, limit, offset, items: rows.map(excelRowToDto) };
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
    const id = Number(idRaw);
    const updated = await updateExcelMapping(await getDb(), id, dto);
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

