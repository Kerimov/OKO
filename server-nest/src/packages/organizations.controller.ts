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
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { getDb } from "../../../server/src/db.js";
import {
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
  @ApiOperation({ summary: "Список организаций (ZID)" })
  async list(@Req() req: Request) {
    const orgZid = userZid(req);
    const all = await listOrganizations(await getDb());
    return orgZid != null ? all.filter((o) => o.zid === orgZid) : all;
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
