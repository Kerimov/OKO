import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { getDb } from "../../../server/src/db.js";
import { createPeriod, listPeriods } from "../../../server/src/packages.js";
import { userZid } from "../../../server/src/orgScope.js";
import { AdminGuard } from "../auth/admin.guard.js";
import { CreatePeriodDto } from "./dto/packages.dto.js";

@ApiTags("periods")
@ApiBearerAuth()
@Controller("periods")
export class PeriodsController {
  @Get()
  @ApiOperation({ summary: "Периоды отчётности (EID)" })
  @ApiQuery({ name: "zid", required: false })
  async list(@Req() req: Request, @Query("zid") zidQuery?: string) {
    const orgZid = userZid(req);
    const zid = orgZid ?? (zidQuery != null ? Number(zidQuery) : undefined);
    return listPeriods(await getDb(), zid);
  }

  @Post()
  @UseGuards(AdminGuard)
  @HttpCode(201)
  @ApiOperation({ summary: "Создать период (admin)" })
  async create(@Body() body: CreatePeriodDto) {
    if (!body.zid || !body.name?.trim()) {
      throw new BadRequestException({ error: "zid and name required" });
    }
    try {
      return await createPeriod(await getDb(), body);
    } catch (e) {
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "create failed",
      });
    }
  }
}
