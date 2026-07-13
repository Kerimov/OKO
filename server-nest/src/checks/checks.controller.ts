import {
  BadRequestException,
  Body,
  ConflictException,
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
import {
  type CheckRuleDto,
  dtoToRow,
  exportChecksPayload,
  getCheckRuleByNumber,
  getChecksStats,
  listCheckRules,
  reimportCheckRulesFromJson,
} from "../../../server/src/checks.js";
import { getDb } from "../../../server/src/db.js";
import { AdminGuard } from "../auth/admin.guard.js";

@ApiTags("checks")
@ApiBearerAuth()
@Controller("checks")
export class ChecksController {
  @Get("stats")
  @ApiOperation({ summary: "Статистика увязок" })
  async stats() {
    return getChecksStats(await getDb());
  }

  @Get("export")
  @ApiOperation({ summary: "Экспорт всех увязок" })
  async exportAll() {
    return exportChecksPayload(await getDb());
  }

  @Get()
  @ApiOperation({ summary: "Список увязок (пагинация)" })
  @ApiQuery({ name: "limit", required: false })
  @ApiQuery({ name: "offset", required: false })
  @ApiQuery({ name: "q", required: false })
  @ApiQuery({ name: "formId", required: false })
  @ApiQuery({ name: "active", required: false })
  @ApiQuery({ name: "periodActive", required: false })
  async list(
    @Query("limit") limitRaw?: string,
    @Query("offset") offsetRaw?: string,
    @Query("q") q?: string,
    @Query("formId") formId?: string,
    @Query("active") active?: string,
    @Query("periodActive") periodActive?: string
  ) {
    return listCheckRules(await getDb(), {
      limit: limitRaw != null ? Number(limitRaw) : undefined,
      offset: offsetRaw != null ? Number(offsetRaw) : undefined,
      q,
      formId,
      active,
      periodActive,
    });
  }

  @Post("reimport")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Перезагрузить увязки из checks.json" })
  async reimport() {
    try {
      const count = await reimportCheckRulesFromJson(await getDb());
      return { reimported: count };
    } catch (e) {
      throw new InternalServerErrorException({
        error: e instanceof Error ? e.message : "reimport failed",
      });
    }
  }

  @Get(":number")
  @ApiOperation({ summary: "Увязка по номеру" })
  async getOne(@Param("number") numberRaw: string) {
    const rule = await getCheckRuleByNumber(await getDb(), Number(numberRaw));
    if (!rule) {
      throw new NotFoundException({ error: "Not found" });
    }
    return rule;
  }

  @Post()
  @UseGuards(AdminGuard)
  @HttpCode(201)
  @ApiOperation({ summary: "Создать увязку" })
  async create(@Body() dto: CheckRuleDto) {
    if (!dto.number || !dto.expression?.trim()) {
      throw new BadRequestException({ error: "number and expression required" });
    }
    const db = await getDb();
    const r = dtoToRow(dto);
    try {
      await db.prepare(
        `INSERT INTO check_rules (
          number, expression, expression_alt, message,
          for_aggr_only, first_level, active, period_active, period, info
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        r.number,
        r.expression,
        r.expression_alt,
        r.message,
        r.for_aggr_only,
        r.first_level,
        r.active,
        r.period_active,
        r.period,
        r.info
      );
      return dto;
    } catch {
      throw new ConflictException({ error: "Rule number already exists" });
    }
  }

  @Put(":number")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Обновить увязку" })
  async update(@Param("number") numberRaw: string, @Body() dto: CheckRuleDto) {
    const num = Number(numberRaw);
    if (dto.number !== num) {
      throw new BadRequestException({ error: "number mismatch" });
    }
    const db = await getDb();
    const r = dtoToRow(dto);
    const result = await db.prepare(
      `UPDATE check_rules SET
        expression = ?, expression_alt = ?, message = ?,
        for_aggr_only = ?, first_level = ?, active = ?, period_active = ?,
        period = ?, info = ?
       WHERE number = ?`
    ).run(
      r.expression,
      r.expression_alt,
      r.message,
      r.for_aggr_only,
      r.first_level,
      r.active,
      r.period_active,
      r.period,
      r.info,
      num
    );
    if (result.changes === 0) {
      throw new NotFoundException({ error: "Not found" });
    }
    return dto;
  }

  @Delete(":number")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Удалить увязку" })
  async remove(@Param("number") numberRaw: string) {
    const result = await (await getDb())
      .prepare("DELETE FROM check_rules WHERE number = ?")
      .run(Number(numberRaw));
    if (result.changes === 0) {
      throw new NotFoundException({ error: "Not found" });
    }
    return { ok: true as const };
  }
}
