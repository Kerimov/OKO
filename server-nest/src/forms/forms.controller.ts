import {
  createFormSchema,
  cascadeRenameColumnKey,
  exportCatalog,
  getFormDependencies,
  loadFormSchema,
  previewFormsReimport,
  reimportFormsFromJson,
  replaceFormColumns,
  replaceFormRows,
  saveFormSchemaAtomic,
  setFormArchived,
  updateFormMeta,
  type FormColumnDto,
  type FormRowDto,
  type FormSchemaDto,
} from "../../../server/src/forms.js";
import { getDb } from "../../../server/src/db.js";
import { AdminGuard } from "../auth/admin.guard.js";
import {
  deleteCellDefinition,
  listCellDefinitions,
  upsertCellDefinition,
  saveTemplateRevision,
} from "../../../server/src/spreadsheet.js";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";

@ApiTags("forms")
@ApiBearerAuth()
@Controller("forms")
export class FormsController {
  @Get("catalog")
  @ApiOperation({ summary: "Каталог форм" })
  async catalog() {
    return exportCatalog(await getDb());
  }

  @Post("import-preview")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Предпросмотр импорта шаблонов из JSON (без записи)" })
  async importPreview() {
    try {
      return await previewFormsReimport(await getDb());
    } catch (e) {
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "preview failed",
      });
    }
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

  @Post()
  @UseGuards(AdminGuard)
  @HttpCode(201)
  @ApiOperation({ summary: "Создать или клонировать форму" })
  async create(
    @Body() body: { id: string; title?: string; category?: string; cloneFrom?: string }
  ) {
    if (!body?.id?.trim()) throw new BadRequestException({ error: "id required" });
    try {
      return await createFormSchema(await getDb(), {
        id: body.id,
        title: body.title || body.id,
        category: body.category,
        cloneFrom: body.cloneFrom,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "create failed";
      if (/уже существует/i.test(msg)) throw new ConflictException({ error: msg });
      throw new BadRequestException({ error: msg });
    }
  }

  @Get(":id/dependencies")
  @ApiOperation({ summary: "Зависимости шаблона (проверки, сальдо, rash, excel…)" })
  @ApiQuery({ name: "columnKey", required: false })
  @ApiQuery({ name: "rowNo", required: false })
  async deps(
    @Param("id") id: string,
    @Query("columnKey") columnKey?: string,
    @Query("rowNo") rowNo?: string
  ) {
    if (!(await loadFormSchema(await getDb(), id))) {
      throw new NotFoundException({ error: "Form not found" });
    }
    return getFormDependencies(await getDb(), id, { columnKey, rowNo });
  }

  @Get(":id")
  @ApiOperation({ summary: "Схема формы (опционально ?version=N — pin из revisions)" })
  @ApiQuery({ name: "version", required: false })
  async getOne(@Param("id") id: string, @Query("version") versionRaw?: string) {
    const db = await getDb();
    const version =
      versionRaw != null && versionRaw !== "" ? Number(versionRaw) : undefined;
    if (version != null && Number.isFinite(version)) {
      const { loadFormSchemaAtVersion } = await import("../../../server/src/spreadsheet.js");
      const schema = await loadFormSchemaAtVersion(db, id, version);
      if (!schema) throw new NotFoundException({ error: "Form not found" });
      return schema;
    }
    const schema = await loadFormSchema(db, id);
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
    await updateFormMeta(db, id, body as Parameters<typeof updateFormMeta>[2]);
    return loadFormSchema(db, id);
  }

  @Put(":id/archive")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Архивировать / разархивировать форму" })
  async archive(@Param("id") id: string, @Body() body: { archived?: boolean }) {
    try {
      return await setFormArchived(await getDb(), id, body?.archived !== false);
    } catch {
      throw new NotFoundException({ error: "Form not found" });
    }
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

  @Get(":id/cell-definitions")
  @ApiOperation({ summary: "Определения ячеек шаблона (формулы/стили)" })
  async cellDefinitions(@Param("id") id: string) {
    if (!(await loadFormSchema(await getDb(), id))) {
      throw new NotFoundException({ error: "Form not found" });
    }
    return listCellDefinitions(await getDb(), id);
  }

  @Put(":id/cell-definitions")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Сохранить определение ячейки" })
  async putCellDefinition(
    @Param("id") id: string,
    @Body()
    body: {
      rowId: string;
      columnKey: string;
      formulaA1?: string | null;
      formulaStable?: string | null;
      readonly?: boolean;
      style?: unknown;
      validation?: unknown;
      numberFormat?: string | null;
      helpText?: string | null;
    }
  ) {
    if (!(await loadFormSchema(await getDb(), id))) {
      throw new NotFoundException({ error: "Form not found" });
    }
    if (!body?.rowId || !body?.columnKey) {
      throw new BadRequestException({ error: "rowId and columnKey required" });
    }
    const db = await getDb();
    const result = await upsertCellDefinition(db, { formId: id, ...body });
    const { bumpFormSchemaVersion } = await import("../../../server/src/forms.js");
    await bumpFormSchemaVersion(db, id, "admin");
    return result;
  }

  @Delete(":id/cell-definitions")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Удалить определение ячейки" })
  @ApiQuery({ name: "rowId", required: true })
  @ApiQuery({ name: "columnKey", required: true })
  async removeCellDefinition(
    @Param("id") id: string,
    @Query("rowId") rowId?: string,
    @Query("columnKey") columnKey?: string
  ) {
    if (!(await loadFormSchema(await getDb(), id))) {
      throw new NotFoundException({ error: "Form not found" });
    }
    if (!rowId?.trim() || !columnKey?.trim()) {
      throw new BadRequestException({ error: "rowId and columnKey required" });
    }
    return deleteCellDefinition(await getDb(), id, rowId.trim(), columnKey.trim());
  }

  @Post(":id/columns/rename")
  @UseGuards(AdminGuard)
  @HttpCode(200)
  @ApiOperation({ summary: "Переименовать графу с каскадом ссылок (admin)" })
  async renameColumn(
    @Param("id") id: string,
    @Body() body: { fromKey?: string; toKey?: string }
  ) {
    if (!body?.fromKey?.trim() || !body?.toKey?.trim()) {
      throw new BadRequestException({ error: "fromKey and toKey required" });
    }
    try {
      return await cascadeRenameColumnKey(
        await getDb(),
        id,
        body.fromKey.trim(),
        body.toKey.trim()
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "rename failed";
      if (/not found/i.test(msg)) throw new NotFoundException({ error: msg });
      if (/already exists|нельзя/i.test(msg)) {
        throw new ConflictException({ error: msg });
      }
      throw new BadRequestException({ error: msg });
    }
  }

  @Put(":id/schema")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Обновить schema целиком (атомарно, admin)" })
  async replaceSchema(@Param("id") id: string, @Body() body: FormSchemaDto) {
    if (body.id !== id) throw new BadRequestException({ error: "id mismatch" });
    try {
      const saved = await saveFormSchemaAtomic(await getDb(), body);
      await saveTemplateRevision(
        await getDb(),
        id,
        saved.schemaVersion ?? 1,
        saved,
        "admin"
      );
      return saved;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "save failed";
      if (/not found/i.test(msg)) throw new NotFoundException({ error: msg });
      throw new BadRequestException({ error: msg });
    }
  }
}
