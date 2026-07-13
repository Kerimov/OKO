import { Controller, Get, NotFoundException } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import fs from "fs";
import path from "path";
import { ROOT } from "../../../server/src/paths.js";

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
}
