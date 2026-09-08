import { Controller, Get, NotFoundException, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import fs from "fs";
import path from "path";
import { ROOT } from "../../../domain/src/paths.js";
import { Public } from "../auth/decorators/public.decorator.js";

@ApiTags("templates")
@Controller("templates")
export class TemplatesController {
  @Public()
  @Get("minfin")
  @ApiOperation({ summary: "Шаблон МинФин (xlsx)" })
  minfin(@Res() res: Response) {
    const candidates = [
      path.join(ROOT, "web", "portal", "public", "templates", "minfin.xlsx"),
      path.join(ROOT, "archive", "kits", "12345", "ШаблоныФорм-МинФин.xlsx"),
      path.join(ROOT, "archive", "reference", "ШаблоныФорм-МинФин.xlsx"),
    ];
    const templatePath = candidates.find((p) => fs.existsSync(p));
    if (!templatePath) {
      throw new NotFoundException("Template not found");
    }
    res.sendFile(templatePath);
  }
}
