import {
  Body,
  Controller,
  Get,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { getDb } from "../../../server/src/db.js";
import {
  countOrganizations,
  createOrganization,
  listOrganizations,
  updateOrganization,
} from "../../../server/src/packages.js";
import { userZid } from "../../../server/src/orgScope.js";
import { AdminGuard } from "../auth/admin.guard.js";
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
} from "./dto/packages.dto.js";

@ApiTags("organizations")
@ApiBearerAuth()
@Controller("organizations")
export class OrganizationsController {
  @Get()
  @ApiOperation({
    summary: "Список организаций (ZID). Поддержка q/limit/offset; без limit — до 2000 строк.",
  })
  @ApiQuery({ name: "q", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiQuery({ name: "offset", required: false })
  @ApiQuery({
    name: "total",
    required: false,
    description: "Если 1 — ответ { items, total } вместо массива",
  })
  async list(
    @Req() req: Request,
    @Query("q") q?: string,
    @Query("limit") limitRaw?: string,
    @Query("offset") offsetRaw?: string,
    @Query("total") totalRaw?: string
  ) {
    const orgZid = userZid(req);
    const limitParsed =
      limitRaw != null && limitRaw !== "" ? Number(limitRaw) : undefined;
    const offsetParsed =
      offsetRaw != null && offsetRaw !== "" ? Number(offsetRaw) : undefined;
    // Cap unbounded list so the portal cannot pull millions of rows by accident.
    const limit =
      limitParsed != null && Number.isFinite(limitParsed)
        ? limitParsed
        : 2000;
    const opts = {
      q: q?.trim() || undefined,
      limit,
      offset:
        offsetParsed != null && Number.isFinite(offsetParsed)
          ? offsetParsed
          : undefined,
      zid: orgZid ?? undefined,
    };
    const db = await getDb();
    const items = await listOrganizations(db, opts);
    if (totalRaw === "1" || totalRaw === "true") {
      const total = await countOrganizations(db, {
        q: opts.q,
        zid: opts.zid,
      });
      return { items, total };
    }
    return items;
  }

  @Post()
  @UseGuards(AdminGuard)
  @HttpCode(201)
  @ApiOperation({ summary: "Создать организацию (admin)" })
  async create(@Body() body: CreateOrganizationDto) {
    try {
      return await createOrganization(await getDb(), body);
    } catch (e) {
      throw new InternalServerErrorException({
        error: e instanceof Error ? e.message : "create failed",
      });
    }
  }

  @Put(":zid")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Обновить организацию (admin)" })
  async update(
    @Param("zid", ParseIntPipe) zid: number,
    @Body() body: UpdateOrganizationDto
  ) {
    try {
      return await updateOrganization(await getDb(), zid, body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "update failed";
      if (/не найдена/i.test(msg)) throw new NotFoundException({ error: msg });
      throw new InternalServerErrorException({ error: msg });
    }
  }
}
