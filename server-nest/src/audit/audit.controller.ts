import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { getDb } from "../../../server/src/db.js";
import { listAuditLog } from "../../../server/src/audit.js";
import { AdminGuard } from "../auth/admin.guard.js";

@ApiTags("audit")
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller("audit")
export class AuditController {
  @Get()
  @ApiOperation({ summary: "Журнал изменений (admin)" })
  @ApiQuery({ name: "q", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiQuery({ name: "offset", required: false })
  async list(@Query("q") qRaw?: string, @Query("limit") limitRaw?: string, @Query("offset") offsetRaw?: string) {
    const q = String(qRaw ?? "");
    const limit = Number(limitRaw) || 50;
    const offset = Number(offsetRaw) || 0;
    return listAuditLog(await getDb(), { q, limit, offset });
  }
}

