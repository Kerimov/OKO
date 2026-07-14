import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { getAuthConfig } from "../../../server/src/auth.js";
import { getDb } from "../../../server/src/db.js";
import { getInstanceStorageStats } from "../../../server/src/instances.js";
import { listAppliedMigrations } from "../../../server/src/migrations/runner.js";
import { isPostgresMode } from "../../../server/src/oko-db.js";
import { getRequestMetrics } from "../common/request-log.middleware.js";
import { Public } from "../auth/decorators/public.decorator.js";

@ApiTags("system")
@Controller()
export class HealthController {
  @Public()
  @Get("health")
  @ApiOperation({ summary: "Health check (DB + metrics)" })
  async health() {
    const stats = await getInstanceStorageStats(await getDb());
    const metrics = getRequestMetrics();
    return {
      ok: true,
      ...(process.env.OKO_RUNTIME ? { runtime: process.env.OKO_RUNTIME } : {}),
      db: isPostgresMode() ? "postgresql" : "sqlite",
      cells: stats,
      auth: getAuthConfig(),
      metrics: {
        uptimeSince: metrics.startedAt,
        requests: metrics.requests,
        errors5xx: metrics.errors,
        lastRequestAt: metrics.lastRequestAt,
      },
    };
  }

  @Public()
  @Get("ready")
  @ApiOperation({ summary: "Readiness probe (lightweight DB ping + migrations)" })
  async ready() {
    try {
      const db = await getDb();
      await db.prepare("SELECT 1 AS ok").get();
      const migrations = await listAppliedMigrations(db);
      return {
        ok: true,
        db: isPostgresMode() ? "postgresql" : "sqlite",
        migrations,
      };
    } catch (e) {
      throw new ServiceUnavailableException({
        ok: false,
        error: e instanceof Error ? e.message : "not ready",
      });
    }
  }
}

