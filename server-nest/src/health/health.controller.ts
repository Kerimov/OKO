import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { getAuthConfig } from "../../../server/src/auth.js";
import { getDb } from "../../../server/src/db.js";
import { getInstanceStorageStats } from "../../../server/src/instances.js";
import { isPostgresMode } from "../../../server/src/oko-db.js";
import { Public } from "../auth/decorators/public.decorator.js";

@ApiTags("system")
@Controller()
export class HealthController {
  @Public()
  @Get("health")
  @ApiOperation({ summary: "Health check" })
  async health() {
    const stats = await getInstanceStorageStats(await getDb());
    return {
      ok: true,
      ...(process.env.OKO_RUNTIME ? { runtime: process.env.OKO_RUNTIME } : {}),
      db: isPostgresMode() ? "postgresql" : "sqlite",
      cells: stats,
      auth: getAuthConfig(),
    };
  }
}

