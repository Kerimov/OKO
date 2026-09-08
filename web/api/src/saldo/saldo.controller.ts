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
import { getDb } from "../../../domain/src/db.js";
import {
  createSaldoRule,
  deleteSaldoRule,
  exportFormCorrespondencePayload,
  exportSaldoPayload,
  getFormCorrespondence,
  getSaldoRule,
  getSaldoStats,
  listSaldoRules,
  reimportFormCorrespondenceFromJson,
  reimportSaldoRulesFromJson,
  updateFormCorrespondence,
  updateSaldoRule,
  type FormCorrespondenceDto,
  type SaldoRuleDto,
} from "../../../domain/src/saldo.js";
import { AdminGuard } from "../auth/admin.guard.js";

@ApiTags("saldo")
@ApiBearerAuth()
@Controller()
export class SaldoController {
  @Get("saldo/stats")
  @ApiOperation({ summary: "Статистика правил сальдо" })
  async stats() {
    return getSaldoStats(await getDb());
  }

  @Get("saldo/export")
  @ApiOperation({ summary: "Экспорт правил сальдо" })
  async exportAll() {
    return exportSaldoPayload(await getDb());
  }

  @Get("saldo")
  @ApiOperation({ summary: "Список правил сальдо (пагинация)" })
  @ApiQuery({ name: "limit", required: false })
  @ApiQuery({ name: "offset", required: false })
  @ApiQuery({ name: "q", required: false })
  @ApiQuery({ name: "formId", required: false })
  @ApiQuery({ name: "saldoType", required: false, description: "t|s|g" })
  async list(
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
    @Query("q") q?: string,
    @Query("formId") formId?: string,
    @Query("saldoType") saldoType?: string
  ) {
    return listSaldoRules(await getDb(), {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      q,
      formId,
      saldoType,
    });
  }

  @Get("saldo/:number")
  @ApiOperation({ summary: "Правило сальдо по номеру" })
  async getOne(@Param("number") numberRaw: string) {
    const item = await getSaldoRule(await getDb(), Number(numberRaw));
    if (!item) throw new NotFoundException({ error: "Not found" });
    return item;
  }

  @Post("saldo")
  @UseGuards(AdminGuard)
  @HttpCode(201)
  @ApiOperation({ summary: "Создать правило сальдо (admin)" })
  async createSaldo(@Body() dto: SaldoRuleDto) {
    try {
      return await createSaldoRule(await getDb(), dto);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "insert failed";
      if (msg.includes("required")) throw new BadRequestException({ error: msg });
      throw new ConflictException({ error: msg });
    }
  }

  @Put("saldo/:number")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Обновить правило сальдо (admin)" })
  async updateSaldo(@Param("number") numberRaw: string, @Body() dto: SaldoRuleDto) {
    const updated = await updateSaldoRule(await getDb(), Number(numberRaw), dto);
    if (!updated) throw new NotFoundException({ error: "Not found" });
    return updated;
  }

  @Delete("saldo/:number")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Удалить правило сальдо (admin)" })
  async deleteSaldo(@Param("number") numberRaw: string) {
    const ok = await deleteSaldoRule(await getDb(), Number(numberRaw));
    if (!ok) throw new NotFoundException({ error: "Not found" });
    return { ok: true as const };
  }

  @Post("saldo/reimport")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Перезагрузить saldo-rules.json (admin)" })
  async reimportSaldo() {
    try {
      const count = await reimportSaldoRulesFromJson(await getDb());
      return { reimported: count };
    } catch (e) {
      throw new InternalServerErrorException({
        error: e instanceof Error ? e.message : "reimport failed",
      });
    }
  }

  @Get("correspondence/export")
  @ApiOperation({ summary: "Экспорт form-correspondence" })
  async exportCorrespondence() {
    return exportFormCorrespondencePayload(await getDb());
  }

  @Get("correspondence/:formId")
  @ApiOperation({ summary: "Correspondence по форме" })
  async getCorrespondence(@Param("formId") formId: string) {
    const item = await getFormCorrespondence(await getDb(), formId);
    if (!item) throw new NotFoundException({ error: "Form not found" });
    return item;
  }

  @Put("correspondence/:formId")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Обновить correspondence (admin)" })
  async updateCorrespondence(@Param("formId") formId: string, @Body() body: FormCorrespondenceDto) {
    const updated = await updateFormCorrespondence(await getDb(), formId, { ...body, formId });
    if (!updated) throw new NotFoundException({ error: "Form not found" });
    return updated;
  }

  @Post("correspondence/reimport")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Перезагрузить form-correspondence.json (admin)" })
  async reimportCorrespondence() {
    try {
      const count = await reimportFormCorrespondenceFromJson(await getDb());
      return { reimported: count };
    } catch (e) {
      throw new InternalServerErrorException({
        error: e instanceof Error ? e.message : "reimport failed",
      });
    }
  }
}
