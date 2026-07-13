import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  exportCatalog,
  loadFormSchema,
  reimportFormsFromJson,
  replaceFormColumns,
  replaceFormRows,
  updateFormMeta,
  type FormColumnDto,
  type FormRowDto,
  type FormSchemaDto,
} from "../../../server/src/forms.js";
import { getDb } from "../../../server/src/db.js";
import { AdminGuard } from "../auth/admin.guard.js";

@ApiTags("forms")
@ApiBearerAuth()
@Controller("forms")
export class FormsController {
  @Get("catalog")
  @ApiOperation({ summary: "Каталог форм" })
  async catalog() {
    return exportCatalog(await getDb());
  }

  @Get(":id")
  @ApiOperation({ summary: "Схема формы" })
  async getOne(@Param("id") id: string) {
    const schema = await loadFormSchema(await getDb(), id);
    if (!schema) throw new NotFoundException({ error: "Form not found" });
    return schema;
  }

  @Put(":id/meta")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Обновить мета формы (admin)" })
  async updateMeta(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    const db = await getDb();
    const exists = await loadFormSchema(db, id);
    if (!exists) throw new NotFoundException({ error: "Form not found" });
    await updateFormMeta(db, id, body as any);
    return loadFormSchema(db, id);
  }

  @Put(":id/columns")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Заменить колонки формы (admin)" })
  async replaceColumns(@Param("id") id: string, @Body() body: unknown) {
    const db = await getDb();
    if (!(await loadFormSchema(db, id))) throw new NotFoundException({ error: "Form not found" });
    if (!Array.isArray(body)) throw new BadRequestException({ error: "columns array required" });
    await replaceFormColumns(db, id, body as FormColumnDto[]);
    return loadFormSchema(db, id);
  }

  @Put(":id/rows")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Заменить строки формы (admin)" })
  async replaceRows(@Param("id") id: string, @Body() body: unknown) {
    const db = await getDb();
    if (!(await loadFormSchema(db, id))) throw new NotFoundException({ error: "Form not found" });
    if (!Array.isArray(body)) throw new BadRequestException({ error: "rows array required" });
    await replaceFormRows(db, id, body as FormRowDto[]);
    return loadFormSchema(db, id);
  }

  @Put(":id/schema")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Обновить schema целиком (admin)" })
  async replaceSchema(@Param("id") id: string, @Body() body: FormSchemaDto) {
    if (body.id !== id) throw new BadRequestException({ error: "id mismatch" });
    const db = await getDb();
    if (!(await loadFormSchema(db, id))) throw new NotFoundException({ error: "Form not found" });
    await updateFormMeta(db, id, {
      title: body.title,
      pages: body.pages,
      allowAddRows: body.allowAddRows,
      kontrForm: body.kontrForm,
      signatures: body.signatures,
    });
    await replaceFormColumns(db, id, body.columns);
    await replaceFormRows(db, id, body.rows);
    return loadFormSchema(db, id);
  }

  @Post("reimport")
  @UseGuards(AdminGuard)
  @HttpCode(200)
  @ApiOperation({ summary: "Перезагрузить формы из catalog.json (admin)" })
  async reimport() {
    try {
      const count = await reimportFormsFromJson(await getDb());
      return { reimported: count };
    } catch (e) {
      throw new InternalServerErrorException({
        error: e instanceof Error ? e.message : "reimport failed",
      });
    }
  }
}

