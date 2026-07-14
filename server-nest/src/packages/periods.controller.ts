import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiQuery, ApiTags } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsNumber, IsOptional } from "class-validator";
import type { Request } from "express";
import { getDb } from "../../../server/src/db.js";
import { logAudit } from "../../../server/src/audit.js";
import {
  createPeriod,
  distributePackagesToChildren,
  listPeriods,
} from "../../../server/src/packages.js";
import {
  closePeriod,
  reopenPeriod,
} from "../../../server/src/periodLifecycle.js";
import { userZid } from "../../../server/src/orgScope.js";
import { AdminGuard } from "../auth/admin.guard.js";
import type { OkoRequest } from "../auth/decorators/oko-request.decorator.js";
import { CreatePeriodDto } from "./dto/packages.dto.js";

class ClosePeriodDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requireAccepted?: boolean;
}

class DistributeDto {
  @ApiPropertyOptional()
  @IsNumber()
  parentZid!: number;

  @ApiPropertyOptional()
  @IsNumber()
  sourceEid!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  createEmptyPackages?: boolean;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  childZids?: number[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  fallbackAllOthers?: boolean;
}

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
  @ApiOperation({ summary: "Создать период (admin); pin методологии + состав форм" })
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

  @Post("distribute")
  @UseGuards(AdminGuard)
  @HttpCode(201)
  @ApiOperation({ summary: "Раздать период/пустые комплекты дочерним org" })
  async distribute(@Body() body: DistributeDto) {
    if (!body.parentZid || !body.sourceEid) {
      throw new BadRequestException({ error: "parentZid and sourceEid required" });
    }
    try {
      return await distributePackagesToChildren(await getDb(), body.parentZid, body.sourceEid, {
        createEmptyPackages: body.createEmptyPackages !== false,
        childZids: body.childZids,
        fallbackAllOthers: body.fallbackAllOthers === true,
      });
    } catch (e) {
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "distribute failed",
      });
    }
  }

  @Post(":eid/close")
  @UseGuards(AdminGuard)
  @HttpCode(200)
  @ApiOperation({ summary: "Закрыть период (immutable)" })
  @ApiQuery({ name: "zid", required: true })
  async close(
    @Req() req: OkoRequest,
    @Param("eid") eidRaw: string,
    @Query("zid") zidRaw: string,
    @Body() body: ClosePeriodDto
  ) {
    const eid = Number(eidRaw);
    const zid = Number(zidRaw);
    if (!Number.isFinite(eid) || !Number.isFinite(zid)) {
      throw new BadRequestException({ error: "zid and eid required" });
    }
    try {
      const result = await closePeriod(await getDb(), zid, eid, req.apiUser?.username ?? "admin", {
        requireAccepted: body?.requireAccepted !== false,
      });
      await logAudit(await getDb(), req as unknown as Request, "POST /api/periods/close", {
        entityType: "period",
        entityId: String(eid),
        details: result,
      });
      return result;
    } catch (e) {
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "close failed",
      });
    }
  }

  @Post(":eid/reopen")
  @UseGuards(AdminGuard)
  @HttpCode(200)
  @ApiOperation({ summary: "Переоткрыть закрытый период (admin + audit)" })
  @ApiQuery({ name: "zid", required: true })
  async reopen(
    @Req() req: OkoRequest,
    @Param("eid") eidRaw: string,
    @Query("zid") zidRaw: string
  ) {
    const eid = Number(eidRaw);
    const zid = Number(zidRaw);
    if (!Number.isFinite(eid) || !Number.isFinite(zid)) {
      throw new BadRequestException({ error: "zid and eid required" });
    }
    try {
      const result = await reopenPeriod(
        await getDb(),
        zid,
        eid,
        req.apiUser?.username ?? "admin"
      );
      await logAudit(await getDb(), req as unknown as Request, "POST /api/periods/reopen", {
        entityType: "period",
        entityId: String(eid),
        details: result,
      });
      return result;
    } catch (e) {
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "reopen failed",
      });
    }
  }
}
