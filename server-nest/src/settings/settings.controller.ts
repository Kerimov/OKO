import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { getDb } from "../../../server/src/db.js";
import { AdminGuard } from "../auth/admin.guard.js";

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
    for (const r of rows) {
      // Work context is per-user via /api/work-context — do not expose global keys here.
      if (r.key === "workZid" || r.key === "workEid" || r.key.startsWith("workZid:") || r.key.startsWith("workEid:")) {
        continue;
      }
      settings[r.key] = r.value;
    }
    return settings;
  }

  @Put()
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Обновить глобальные настройки (admin)" })
  async putAll(@Body() body: Record<string, string>) {
    const db = await getDb();
    await db.transaction(async (tx) => {
      const upsert = tx.prepare(
        "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      );
      for (const [key, value] of Object.entries(body)) {
        if (
          key === "workZid" ||
          key === "workEid" ||
          key.startsWith("workZid:") ||
          key.startsWith("workEid:")
        ) {
          continue;
        }
        const stored = typeof value === "string" ? value : JSON.stringify(value);
        await upsert.run(key, stored);
      }
    });
    return { ok: true as const };
  }
}
