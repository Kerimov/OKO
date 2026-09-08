import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { getDb } from "../../../domain/src/db.js";
import { logDomainAudit } from "../../../domain/src/audit.js";
import {
  activateMethodologyRelease,
  buildChecksums,
  compareMethodologyReleases,
  dryRunMethodology,
  getMethodologyRelease,
  listMethodologyReleases,
  rollbackMethodologyRelease,
  type MethodologyRelease,
} from "../../../domain/src/methodology.js";
import { AdminGuard } from "../auth/admin.guard.js";
import type { OkoRequest } from "../auth/decorators/oko-request.decorator.js";
import { rethrowAsHttp } from "../common/oko-http.js";
import {
  MethodologyActivateDto,
  MethodologyDryRunDto,
  MethodologyRollbackDto,
  MethodologySnapshotDto,
} from "./dto/methodology.dto.js";

@ApiTags("methodology")
@ApiBearerAuth()
@Controller("methodology")
export class MethodologyController {
  @Get()
  @ApiOperation({ summary: "Активный релиз методологии (версия + checksums)" })
  async getActive() {
    return (await getMethodologyRelease(await getDb())) ?? { active: false };
  }

  @Get("history")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "История релизов методологии (admin)" })
  @ApiQuery({ name: "limit", required: false })
  async history(@Query("limit") limitRaw?: string) {
    const limit = Number(limitRaw) || 50;
    return listMethodologyReleases(await getDb(), limit);
  }

  @Get("diff")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Сравнение checksums двух релизов (admin)" })
  @ApiQuery({ name: "left", required: false, description: "id или пусто = active" })
  @ApiQuery({ name: "right", required: true })
  async diff(@Query("left") left?: string, @Query("right") right?: string) {
    if (!right?.trim()) {
      throw new BadRequestException({ error: "right release id required" });
    }
    return compareMethodologyReleases(
      await getDb(),
      left?.trim() || null,
      right.trim()
    );
  }

  @Post("dry-run")
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: "Dry-run методологии: сравнить checksums с активным релизом без записи",
  })
  async dryRun(@Body() body: MethodologyDryRunDto) {
    try {
      return await dryRunMethodology(await getDb(), body);
    } catch (e) {
      rethrowAsHttp(e, "dry-run failed");
    }
  }

  @Post("activate")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Активировать релиз методологии (admin)" })
  async activate(@Req() req: OkoRequest, @Body() body: MethodologyActivateDto) {
    if (!body?.version?.trim()) {
      throw new BadRequestException({ error: "version required" });
    }
    try {
      const db = await getDb();
      const checksums =
        body.checksums && Object.keys(body.checksums).length > 0
          ? body.checksums
          : buildChecksums(body);
      const stored = await activateMethodologyRelease(db, {
        ...body,
        kind: "methodology-release",
        exportedAt: body.exportedAt ?? new Date().toISOString(),
        checksums,
      });
      await logDomainAudit(db, {
        actor: req.apiUser?.username ?? req.apiRole ?? null,
        action: "methodology.activate",
        entityType: "methodology",
        entityId: stored.id ?? stored.version,
        details: { version: stored.version, checksumKeys: Object.keys(stored.checksums) },
      });
      return stored;
    } catch (e) {
      rethrowAsHttp(e, "activate failed");
    }
  }

  @Post("rollback")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Откатить активный релиз на запись из истории (admin)" })
  async rollback(@Req() req: OkoRequest, @Body() body: MethodologyRollbackDto) {
    if (!body?.id?.trim()) {
      throw new BadRequestException({ error: "id required" });
    }
    try {
      const db = await getDb();
      const stored = await rollbackMethodologyRelease(db, body.id.trim());
      await logDomainAudit(db, {
        actor: req.apiUser?.username ?? req.apiRole ?? null,
        action: "methodology.rollback",
        entityType: "methodology",
        entityId: stored.id ?? stored.version,
        details: { version: stored.version },
      });
      return stored;
    } catch (e) {
      rethrowAsHttp(e, "rollback failed");
    }
  }

  @Post("snapshot")
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: "Снапшот текущих правил из JSON портала (checksums без полного payload)",
  })
  async snapshot(
    @Req() req: OkoRequest,
    @Body() body: MethodologySnapshotDto
  ) {
    const version =
      body.version?.trim() ||
      `manual-${new Date().toISOString().slice(0, 10)}`;
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const { ROOT } = await import("../../../domain/src/paths.js");
      const dataDir = path.join(ROOT, "web", "portal", "public", "data");
      const read = (name: string) => {
        const p = path.join(dataDir, name);
        if (!fs.existsSync(p)) return undefined;
        return JSON.parse(fs.readFileSync(p, "utf-8"));
      };
      const parts = {
        checks: read("checks.json"),
        rash: read("rash-rules.json"),
        recalc: read("recalc-rules.json"),
        rowFormulas: read("row-formulas.json"),
        saldo: read("saldo-rules.json"),
        correspondence: read("form-correspondence.json"),
        kontr: read("kontr.json"),
      };
      const db = await getDb();
      const stored = await activateMethodologyRelease(db, {
        kind: "methodology-release",
        version,
        exportedAt: new Date().toISOString(),
        source: body.source ?? "web/portal/public/data",
        checksums: buildChecksums(parts),
      });
      await logDomainAudit(db, {
        actor: req.apiUser?.username ?? req.apiRole ?? null,
        action: "methodology.snapshot",
        entityType: "methodology",
        entityId: stored.id ?? stored.version,
        details: { version: stored.version },
      });
      return stored;
    } catch (e) {
      rethrowAsHttp(e, "snapshot failed");
    }
  }
}
