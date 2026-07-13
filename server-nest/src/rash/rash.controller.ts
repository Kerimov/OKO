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
  deleteRashRule,
  exportRashPayload,
  exportRowRashIndex,
  getRashRule,
  getRashStats,
  getRashThresholds,
  listPlacementsByKod,
  listRashAddsum,
  listRashRules,
  reimportPlacementsFromJson,
  reimportRashFromJson,
  replacePlacementsForKod,
  replaceRashAddsum,
  seedPlacementsFromJson,
  setRashThresholds,
  upsertRashRule,
  type RashAddsumDto,
  type RashPlacementDto,
  type RashRuleDto,
  type RashThresholdsDto,
} from "../../../server/src/rash.js";
import { getDb } from "../../../server/src/db.js";
import { AdminGuard } from "../auth/admin.guard.js";

@ApiTags("rash")
@ApiBearerAuth()
@Controller("rash")
export class RashController {
  @Get("stats")
  @ApiOperation({ summary: "Статистика правил расшифровок" })
  async stats() {
    return getRashStats(await getDb());
  }

  @Get("thresholds")
  @ApiOperation({ summary: "Пороги обязательной расшифровки" })
  async thresholds() {
    return getRashThresholds(await getDb());
  }

  @Put("thresholds")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Обновить пороги обязательной расшифровки" })
  async setThresholds(@Body() body: RashThresholdsDto) {
    return setRashThresholds(await getDb(), body);
  }

  @Get("export")
  @ApiOperation({ summary: "Экспорт правил расшифровок" })
  async exportAll() {
    return exportRashPayload(await getDb());
  }

  @Get("placements/export")
  @ApiOperation({ summary: "Экспорт карты привязок kod→ячейка (row-rash-index)" })
  async exportPlacements() {
    return exportRowRashIndex(await getDb());
  }

  @Post("placements/reimport")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Перезагрузить привязки из row-rash-index.json" })
  async reimportPlacements() {
    try {
      const count = await reimportPlacementsFromJson(await getDb());
      return { reimported: count };
    } catch (e) {
      throw new InternalServerErrorException({
        error: e instanceof Error ? e.message : "placements reimport failed",
      });
    }
  }

  @Get()
  @ApiOperation({ summary: "Список правил расшифровок (пагинация)" })
  @ApiQuery({ name: "limit", required: false })
  @ApiQuery({ name: "offset", required: false })
  @ApiQuery({ name: "q", required: false })
  @ApiQuery({ name: "formId", required: false })
  async list(
    @Query("limit") limitRaw?: string,
    @Query("offset") offsetRaw?: string,
    @Query("q") q?: string,
    @Query("formId") formId?: string
  ) {
    return listRashRules(await getDb(), {
      limit: limitRaw != null ? Number(limitRaw) : undefined,
      offset: offsetRaw != null ? Number(offsetRaw) : undefined,
      q,
      formId,
    });
  }

  @Post("reimport")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Перезагрузить правила из rash-rules.json" })
  async reimport() {
    try {
      const db = await getDb();
      const count = await reimportRashFromJson(db);
      // CASCADE clears placements with rules — restore from row-rash-index.json
      const placements = await seedPlacementsFromJson(db);
      return { reimported: count, placementsSeeded: placements };
    } catch (e) {
      throw new InternalServerErrorException({
        error: e instanceof Error ? e.message : "reimport failed",
      });
    }
  }

  @Get(":kod/addsum")
  @ApiOperation({ summary: "Доп. графы правила (sp_rash_addsum)" })
  async getAddsum(@Param("kod") kodRaw: string) {
    const kod = Number(kodRaw);
    if (!(await getRashRule(await getDb(), kod))) {
      throw new NotFoundException({ error: "Not found" });
    }
    return listRashAddsum(await getDb(), kod);
  }

  @Put(":kod/addsum")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Заменить доп. графы правила" })
  async putAddsum(@Param("kod") kodRaw: string, @Body() body: RashAddsumDto[] | { items: RashAddsumDto[] }) {
    const kod = Number(kodRaw);
    const items = Array.isArray(body) ? body : (body.items ?? []);
    try {
      return await replaceRashAddsum(await getDb(), kod, items);
    } catch (e) {
      if (e instanceof Error && /not found/i.test(e.message)) {
        throw new NotFoundException({ error: e.message });
      }
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "addsum save failed",
      });
    }
  }

  @Get(":kod/placements")
  @ApiOperation({ summary: "Привязки правила к ячейкам форм" })
  async getPlacements(@Param("kod") kodRaw: string) {
    const kod = Number(kodRaw);
    if (!(await getRashRule(await getDb(), kod))) {
      throw new NotFoundException({ error: "Not found" });
    }
    return listPlacementsByKod(await getDb(), kod);
  }

  @Put(":kod/placements")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Заменить привязки правила к ячейкам" })
  async putPlacements(
    @Param("kod") kodRaw: string,
    @Body() body: RashPlacementDto[] | { items: RashPlacementDto[] }
  ) {
    const kod = Number(kodRaw);
    const items = Array.isArray(body) ? body : (body.items ?? []);
    try {
      return await replacePlacementsForKod(await getDb(), kod, items);
    } catch (e) {
      if (e instanceof Error && /not found/i.test(e.message)) {
        throw new NotFoundException({ error: e.message });
      }
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "placements save failed",
      });
    }
  }

  @Get(":kod")
  @ApiOperation({ summary: "Правило расшифровки по коду + addsum" })
  async getOne(@Param("kod") kodRaw: string) {
    const kod = Number(kodRaw);
    const rule = await getRashRule(await getDb(), kod);
    if (!rule) {
      throw new NotFoundException({ error: "Not found" });
    }
    return {
      ...rule,
      addsum: await listRashAddsum(await getDb(), kod),
      placements: await listPlacementsByKod(await getDb(), kod),
    };
  }

  @Post()
  @UseGuards(AdminGuard)
  @HttpCode(201)
  @ApiOperation({ summary: "Создать правило расшифровки" })
  async create(@Body() dto: RashRuleDto) {
    if (!dto.kod || !dto.name?.trim()) {
      throw new BadRequestException({ error: "kod and name required" });
    }
    try {
      await upsertRashRule(await getDb(), dto);
      return dto;
    } catch (e) {
      throw new ConflictException({
        error: e instanceof Error ? e.message : "insert failed",
      });
    }
  }

  @Put(":kod")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Обновить правило расшифровки" })
  async update(@Param("kod") kodRaw: string, @Body() dto: RashRuleDto) {
    const kod = Number(kodRaw);
    if (dto.kod !== kod) {
      throw new BadRequestException({ error: "kod mismatch" });
    }
    await upsertRashRule(await getDb(), dto);
    return dto;
  }

  @Delete(":kod")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Удалить правило расшифровки" })
  async remove(@Param("kod") kodRaw: string) {
    if (!(await deleteRashRule(await getDb(), Number(kodRaw)))) {
      throw new NotFoundException({ error: "Not found" });
    }
    return { ok: true as const };
  }
}
