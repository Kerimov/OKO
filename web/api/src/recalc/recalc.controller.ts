import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import fs from "fs";
import path from "path";
import { getDb } from "../../../server/src/db.js";
import { ROOT } from "../../../server/src/paths.js";
import { listRecalcRules } from "../../../server/src/spreadsheet.js";

const RECALC_JSON = path.join(ROOT, "portal", "public", "data", "recalc-rules.json");

@ApiTags("recalc")
@ApiBearerAuth()
@Controller("recalc")
export class RecalcController {
  @Get("export")
  @ApiOperation({ summary: "Экспорт правил пересчёта (recalc-rules.json)" })
  export() {
    if (!fs.existsSync(RECALC_JSON)) {
      throw new NotFoundException("recalc-rules.json not found");
    }
    return JSON.parse(fs.readFileSync(RECALC_JSON, "utf-8"));
  }

  @Get("rules")
  @ApiQuery({ name: "formId", required: false })
  @ApiOperation({ summary: "Список правил пересчёта из БД" })
  async list(@Query("formId") formId?: string) {
    return listRecalcRules(await getDb(), formId || undefined);
  }

  @Get("rules/:formId")
  @ApiOperation({ summary: "Правила пересчёта формы" })
  async byForm(@Param("formId") formId: string) {
    return listRecalcRules(await getDb(), formId);
  }
}
