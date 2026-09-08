import { Body, Controller, Get, Put, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { getDb } from "../../../server/src/db.js";
import { getWorkContext, setWorkContext } from "../../../server/src/packages.js";
import { userZid } from "../../../server/src/orgScope.js";
import type { SessionUser } from "../../../server/src/users.js";
import { WorkContextDto } from "./dto/packages.dto.js";

type ReqWithUser = Request & { apiUser?: SessionUser };

@ApiTags("work-context")
@ApiBearerAuth()
@Controller("work-context")
export class WorkContextController {
  @Get()
  @ApiOperation({ summary: "Текущие ZID/EID в UI (per-user)" })
  async get(@Req() req: ReqWithUser) {
    const ctx = await getWorkContext(await getDb(), req.apiUser?.id ?? null);
    const orgZid = userZid(req);
    if (orgZid != null) {
      return { zid: orgZid, eid: ctx.eid };
    }
    return ctx;
  }

  @Put()
  @ApiOperation({ summary: "Установить рабочий контекст ZID/EID (per-user)" })
  async put(@Req() req: ReqWithUser, @Body() body: WorkContextDto) {
    const orgZid = userZid(req);
    return setWorkContext(
      await getDb(),
      {
        zid: orgZid ?? body.zid ?? null,
        eid: body.eid ?? null,
      },
      req.apiUser?.id ?? null
    );
  }
}
