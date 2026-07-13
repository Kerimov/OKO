import { Controller, Get, NotFoundException, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import fs from "fs";
import path from "path";
import { ROOT } from "../../../server/src/paths.js";
import { Public } from "../auth/decorators/public.decorator.js";

@ApiTags("templates")
@Controller("templates")
export class TemplatesController {
  @Public()
  @Get("minfin")
  @ApiOperation({ summary: "Шаблон МинФин (xlsx)" })
  minfin(@Res() res: Response) {
    const candidates = [
      path.join(ROOT, "portal", "public", "templates", "minfin.xlsx"),
      path.join(ROOT, "12345", "ШаблоныФорм-МинФин.xlsx"),
      path.join(ROOT, "reference", "ШаблоныФорм-МинФин.xlsx"),
    ];
    const templatePath = candidates.find((p) => fs.existsSync(p));
    if (!templatePath) {
      throw new NotFoundException("Template not found");
    }
    res.sendFile(templatePath);
  }
}
