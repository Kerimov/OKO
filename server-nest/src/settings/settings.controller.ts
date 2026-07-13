import { Body, Controller, Get, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { getDb } from "../../../server/src/db.js";

@ApiTags("settings")
@ApiBearerAuth()
@Controller("settings")
export class SettingsController {
  @Get()
  @ApiOperation({ summary: "Глобальные настройки (app_settings)" })
  async getAll() {
    const db = await getDb();
    const rows = (await db.prepare("SELECT key, value FROM app_settings").all()) as Array<{
      key: string;
      value: string;
    }>;
    const settings: Record<string, string> = {};
    for (const r of rows) settings[r.key] = r.value;
    return settings;
  }

  @Put()
  @ApiOperation({ summary: "Обновить настройки" })
  async putAll(@Body() body: Record<string, string>) {
    const db = await getDb();
    await db.transaction(async (tx) => {
      const upsert = tx.prepare(
        "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      );
      for (const [key, value] of Object.entries(body)) {
        const stored = typeof value === "string" ? value : JSON.stringify(value);
        await upsert.run(key, stored);
      }
    });
    return { ok: true as const };
  }
}
