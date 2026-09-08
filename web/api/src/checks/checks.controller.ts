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
  createCheckRule,
  deleteCheckRule,
  exportChecksPayload,
  getCheckRuleByNumber,
  getChecksStats,
  listCheckRules,
  reimportCheckRulesFromJson,
  updateCheckRule,
} from "../../../domain/src/checks.js";
import { testCheckExpression } from "../../../domain/src/checkTest.js";
import { getDb } from "../../../domain/src/db.js";
import { AdminGuard } from "../auth/admin.guard.js";
import { TestCheckExpressionDto } from "./dto/checks.dto.js";

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

  @Post("test-expression")
  @HttpCode(200)
  @ApiOperation({ summary: "Протестировать выражение увязки на данных сервера" })
  async testExpression(@Body() body: TestCheckExpressionDto) {
    if (!body?.expression?.trim() && !body?.expressionAlt?.trim()) {
      throw new BadRequestException({ error: "expression required" });
    }
    try {
      return await testCheckExpression(await getDb(), {
        expression: body.expression ?? "",
        expressionAlt: body.expressionAlt,
        zid: body.zid,
        eid: body.eid,
      });
    } catch (e) {
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "test failed",
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
    try {
      return await createCheckRule(await getDb(), dto);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "insert failed";
      if (msg.includes("required")) throw new BadRequestException({ error: msg });
      throw new ConflictException({ error: "Rule number already exists" });
    }
  }

  @Put(":number")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Обновить увязку" })
  async update(@Param("number") numberRaw: string, @Body() dto: CheckRuleDto) {
    try {
      const updated = await updateCheckRule(await getDb(), Number(numberRaw), dto);
      if (!updated) throw new NotFoundException({ error: "Not found" });
      return updated;
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      const msg = e instanceof Error ? e.message : "update failed";
      if (msg.includes("mismatch")) throw new BadRequestException({ error: msg });
      throw e;
    }
  }

  @Delete(":number")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Удалить увязку" })
  async remove(@Param("number") numberRaw: string) {
    const ok = await deleteCheckRule(await getDb(), Number(numberRaw));
    if (!ok) throw new NotFoundException({ error: "Not found" });
    return { ok: true as const };
  }
}
