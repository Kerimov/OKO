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
import { getDb } from "../../../server/src/db.js";
import {
  dtoToRow as saldoDtoToRow,
  exportFormCorrespondencePayload,
  exportSaldoPayload,
  getFormCorrespondence,
  getSaldoStats,
  reimportFormCorrespondenceFromJson,
  reimportSaldoRulesFromJson,
  rowToDto as saldoRowToDto,
  updateFormCorrespondence,
  type FormCorrespondenceDto,
  type SaldoRuleDto,
  type SaldoRuleRow,
} from "../../../server/src/saldo.js";
import { AdminGuard } from "../auth/admin.guard.js";

@ApiTags("saldo")
@ApiBearerAuth()
@Controller()
export class SaldoController {
  // -------- saldo rules --------
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
    @Query("limit") limitRaw?: string,
    @Query("offset") offsetRaw?: string,
    @Query("q") qRaw?: string,
    @Query("formId") formIdRaw?: string,
    @Query("saldoType") saldoTypeRaw?: string
  ) {
    const db = await getDb();
    const limit = Math.min(Number(limitRaw) || 50, 500);
    const offset = Number(offsetRaw) || 0;
    const q = String(qRaw ?? "").trim();
    const formId = String(formIdRaw ?? "").trim();
    const saldoType = String(saldoTypeRaw ?? "").trim();

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (q) {
      conditions.push(
        "(CAST(number AS TEXT) LIKE ? OR name LIKE ? OR target_form LIKE ? OR source_form LIKE ?)"
      );
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    if (formId) {
      conditions.push("(target_form = ? OR source_form = ?)");
      params.push(formId, formId);
    }
    if (saldoType === "t") {
      conditions.push(
        "(saldo_t = 1 OR (saldo_t = 0 AND saldo_s = 0 AND saldo_g = 0 AND source_column IS NOT NULL AND source_row IS NOT NULL))"
      );
    }
    if (saldoType === "s") {
      conditions.push(
        "(saldo_s = 1 OR (saldo_t = 0 AND saldo_s = 0 AND saldo_g = 0 AND source_column IS NOT NULL AND source_row IS NOT NULL))"
      );
    }
    if (saldoType === "g") {
      conditions.push(
        "(saldo_g = 1 OR (saldo_t = 0 AND saldo_s = 0 AND saldo_g = 0 AND end_column IS NOT NULL AND end_row IS NOT NULL))"
      );
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = (
      (await db.prepare(`SELECT COUNT(*) AS c FROM saldo_rules ${where}`).get(...params)) as {
        c: number;
      }
    ).c;

    const rows = (await db
      .prepare(
        `SELECT number, target_form, target_column, target_row,
                source_form, source_column, source_row,
                end_form, end_column, end_row,
                saldo_t, saldo_s, saldo_g, name, conditional
         FROM saldo_rules ${where}
         ORDER BY number
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset)) as SaldoRuleRow[];

    return { total, limit, offset, items: rows.map(saldoRowToDto) };
  }

  @Get("saldo/:number")
  @ApiOperation({ summary: "Правило сальдо по номеру" })
  async getOne(@Param("number") numberRaw: string) {
    const db = await getDb();
    const row = (await db
      .prepare(
        `SELECT number, target_form, target_column, target_row,
                source_form, source_column, source_row,
                end_form, end_column, end_row,
                saldo_t, saldo_s, saldo_g, name, conditional
         FROM saldo_rules WHERE number = ?`
      )
      .get(Number(numberRaw))) as SaldoRuleRow | undefined;
    if (!row) throw new NotFoundException({ error: "Not found" });
    return saldoRowToDto(row);
  }

  @Post("saldo")
  @UseGuards(AdminGuard)
  @HttpCode(201)
  @ApiOperation({ summary: "Создать правило сальдо (admin)" })
  async createSaldo(@Body() dto: SaldoRuleDto) {
    if (!dto.number || !dto.targetForm?.trim()) {
      throw new BadRequestException({ error: "number and targetForm required" });
    }
    const db = await getDb();
    const r = saldoDtoToRow(dto);
    try {
      await db
        .prepare(
          `INSERT INTO saldo_rules (
            number, target_form, target_column, target_row,
            source_form, source_column, source_row,
            end_form, end_column, end_row,
            saldo_t, saldo_s, saldo_g, name, conditional
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          r.number,
          r.target_form,
          r.target_column,
          r.target_row,
          r.source_form,
          r.source_column,
          r.source_row,
          r.end_form,
          r.end_column,
          r.end_row,
          r.saldo_t,
          r.saldo_s,
          r.saldo_g,
          r.name,
          r.conditional
        );
      return saldoRowToDto(r);
    } catch (e) {
      throw new ConflictException({ error: e instanceof Error ? e.message : "insert failed" });
    }
  }

  @Put("saldo/:number")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Обновить правило сальдо (admin)" })
  async updateSaldo(@Param("number") numberRaw: string, @Body() dto: SaldoRuleDto) {
    const number = Number(numberRaw);
    const db = await getDb();
    const r = saldoDtoToRow({ ...dto, number });
    const result = await db
      .prepare(
        `UPDATE saldo_rules SET
          target_form = ?, target_column = ?, target_row = ?,
          source_form = ?, source_column = ?, source_row = ?,
          end_form = ?, end_column = ?, end_row = ?,
          saldo_t = ?, saldo_s = ?, saldo_g = ?, name = ?, conditional = ?
         WHERE number = ?`
      )
      .run(
        r.target_form,
        r.target_column,
        r.target_row,
        r.source_form,
        r.source_column,
        r.source_row,
        r.end_form,
        r.end_column,
        r.end_row,
        r.saldo_t,
        r.saldo_s,
        r.saldo_g,
        r.name,
        r.conditional,
        number
      );
    if (result.changes === 0) throw new NotFoundException({ error: "Not found" });
    return saldoRowToDto(r);
  }

  @Delete("saldo/:number")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Удалить правило сальдо (admin)" })
  async deleteSaldo(@Param("number") numberRaw: string) {
    const db = await getDb();
    const result = await db
      .prepare("DELETE FROM saldo_rules WHERE number = ?")
      .run(Number(numberRaw));
    if (result.changes === 0) throw new NotFoundException({ error: "Not found" });
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

  // -------- form correspondence --------
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

