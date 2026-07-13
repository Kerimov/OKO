import {
  Body,
  Controller,
  Get,
  HttpCode,
  InternalServerErrorException,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { getDb } from "../../../server/src/db.js";
import { createOrganization, listOrganizations } from "../../../server/src/packages.js";
import { userZid } from "../../../server/src/orgScope.js";
import { AdminGuard } from "../auth/admin.guard.js";
import { CreateOrganizationDto } from "./dto/packages.dto.js";

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
}
