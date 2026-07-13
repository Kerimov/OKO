import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  InternalServerErrorException,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import {
  createKontrAgent,
  getKontrStats,
  listKontrAgents,
  reimportKontrFromJson,
  searchKontrAgents,
  type KontrAgentDto,
} from "../../../server/src/kontr.js";
import { getDb } from "../../../server/src/db.js";
import { AdminGuard } from "../auth/admin.guard.js";

@ApiTags("kontr")
@ApiBearerAuth()
@Controller("kontr")
export class KontrController {
  @Get("stats")
  @ApiOperation({ summary: "Статистика справочника контрагентов" })
  async stats() {
    return getKontrStats(await getDb());
  }

  @Get()
  @ApiOperation({ summary: "Справочник контрагентов (поиск / список)" })
  @ApiQuery({ name: "q", required: false })
  @ApiQuery({ name: "orgTypes", required: false })
  @ApiQuery({ name: "limit", required: false })
  async list(
    @Query("q") qRaw?: string,
    @Query("orgTypes") orgTypesRaw?: string,
    @Query("limit") limitRaw?: string
  ) {
    const db = await getDb();
    const q = String(qRaw ?? "").trim();
    const orgTypesStr = String(orgTypesRaw ?? "").trim();
    const limit = Math.min(Number(limitRaw) || 500, 5000);

    if (q || orgTypesStr) {
      const orgTypes = orgTypesStr
        ? orgTypesStr.split(",").map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite)
        : null;
      return searchKontrAgents(db, q, orgTypes, limit);
    }

    const all = await listKontrAgents(db);
    if (all.length > 2000) {
      return all.slice(0, limit);
    }
    return all;
  }

  @Post("reimport")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Перезагрузить kontr.json (admin)" })
  async reimport() {
    try {
      const count = await reimportKontrFromJson(await getDb());
      return { reimported: count };
    } catch (e) {
      throw new InternalServerErrorException({
        error: e instanceof Error ? e.message : "reimport failed",
      });
    }
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: "Создать контрагента" })
  async create(@Body() body: Omit<KontrAgentDto, "id"> & { name: string }) {
    if (!body.name?.trim()) {
      throw new BadRequestException({ error: "name required" });
    }
    return createKontrAgent(await getDb(), body);
  }
}
