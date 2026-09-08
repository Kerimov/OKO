import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  InternalServerErrorException,
  Param,
  ParseIntPipe,
  Patch,
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
  renameKontrAgent,
  searchKontrAgents,
  updateKontrAgent,
  bulkUpsertKontrAgents,
  type KontrAgentDto,
  type KontrBulkItem,
} from "../../../server/src/kontr.js";
import { getDb } from "../../../server/src/db.js";
import { AdminGuard } from "../auth/admin.guard.js";
import {
  PsdPermissionGuard,
  RequirePsdPermissions,
} from "../auth/psd-permission.guard.js";
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
  ArrayMaxSize,
  ArrayMinSize,
} from "class-validator";
import { Type } from "class-transformer";

class KontrBulkItemDto {
  @IsOptional()
  @IsInt()
  id?: number | null;

  @IsString()
  @MaxLength(500)
  name!: string;

  @IsOptional()
  @IsString()
  oldName?: string | null;

  @IsOptional()
  @IsString()
  inn?: string | null;

  @IsOptional()
  @IsString()
  kpp?: string | null;

  @IsOptional()
  @IsInt()
  orgType?: number | null;

  @IsOptional()
  @IsString()
  idObdnsi?: string | null;

  @IsOptional()
  @IsString()
  orgForm?: string | null;

  @IsOptional()
  @IsBoolean()
  mandatoryRash?: boolean;
}

class KontrBulkBodyDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => KontrBulkItemDto)
  items!: KontrBulkItemDto[];
}

@ApiTags("kontr")
@ApiBearerAuth()
@UseGuards(PsdPermissionGuard)
@Controller("kontr")
export class KontrController {
  @Get("stats")
  @RequirePsdPermissions("nsi.read")
  @ApiOperation({ summary: "Статистика справочника контрагентов" })
  async stats() {
    return getKontrStats(await getDb());
  }

  @Get()
  @RequirePsdPermissions("nsi.read")
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
  @RequirePsdPermissions("tech.configure")
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

  @Post("bulk")
  @RequirePsdPermissions("nsi.write")
  @ApiOperation({ summary: "Пакетное создание/обновление контрагентов (транзакция)" })
  async bulk(@Body() body: KontrBulkBodyDto) {
    try {
      return await bulkUpsertKontrAgents(
        await getDb(),
        body.items as KontrBulkItem[]
      );
    } catch (e) {
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "bulk failed",
      });
    }
  }

  @Post()
  @HttpCode(201)
  @RequirePsdPermissions("nsi.write")
  @ApiOperation({ summary: "Создать контрагента" })
  async create(@Body() body: Omit<KontrAgentDto, "id"> & { name: string }) {
    if (!body.name?.trim()) {
      throw new BadRequestException({ error: "name required" });
    }
    try {
      return await createKontrAgent(await getDb(), body);
    } catch (e) {
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "create failed",
      });
    }
  }

  @Patch(":id")
  @RequirePsdPermissions("nsi.write")
  @ApiOperation({ summary: "Обновить контрагента" })
  async update(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: Partial<Omit<KontrAgentDto, "id">>
  ) {
    try {
      return await updateKontrAgent(await getDb(), id, body);
    } catch (e) {
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "update failed",
      });
    }
  }

  @Post(":id/rename")
  @RequirePsdPermissions("nsi.write")
  @ApiOperation({ summary: "Переименовать: имя → oldName, новое имя (N99)" })
  async rename(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: { name?: string }
  ) {
    if (!body.name?.trim()) {
      throw new BadRequestException({ error: "name required" });
    }
    try {
      return await renameKontrAgent(await getDb(), id, body.name);
    } catch (e) {
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "rename failed",
      });
    }
  }
}
