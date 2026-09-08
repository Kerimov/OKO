import { Body, Controller, Get, Put, UseGuards, ValidationPipe } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { getDb } from "../../../domain/src/db.js";
import {
  listPublicAppSettings,
  upsertPublicAppSettings,
} from "../../../domain/src/appSettings.js";
import { AdminGuard } from "../auth/admin.guard.js";
import { SettingsMapDto } from "./dto/settings.dto.js";

@ApiTags("settings")
@ApiBearerAuth()
@Controller("settings")
export class SettingsController {
  @Get()
  @ApiOperation({ summary: "Глобальные настройки (app_settings)" })
  async getAll() {
    return listPublicAppSettings(await getDb());
  }

  @Put()
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Обновить глобальные настройки (admin)" })
  async putAll(@Body(new ValidationPipe({ whitelist: false })) body: SettingsMapDto) {
    return upsertPublicAppSettings(await getDb(), body);
  }
}
