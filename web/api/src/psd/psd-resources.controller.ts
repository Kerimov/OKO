import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { getDb } from "../../../server/src/db.js";
import {
  listCollectionUnits,
  upsertCollectionUnit,
  type CollectionUnitKind,
} from "../../../server/src/collectionUnits.js";
import {
  archiveKontragent,
  createKontrVersion,
  findKontrUsages,
  getKontrVersionAt,
  listKontrVersions,
} from "../../../server/src/kontrVersions.js";
import {
  appendCheckRunJournal,
  getApprovalBlockers,
  listCheckExplanations,
  listCheckJournal,
  upsertCheckExplanation,
} from "../../../server/src/checkJournal.js";
import { parseCheckDsl } from "../../../server/src/checkDsl.js";
import { runPackageChecks } from "../../../server/src/packageCheckRun.js";
import {
  createSvodDefinition,
  listSvodDefinitions,
  svodDetailDrilldown,
  calculateSvod,
  copySvodFromPreviousPeriod,
  svodDrilldown,
} from "../../../server/src/svodRegistry.js";
import {
  bulkUpsertMinfinMappings,
  bulkUpsertTransferMaps,
  listMinfinMappings,
  listTransferMaps,
  type TransferMapKind,
} from "../../../server/src/transferMaps.js";
import { applyTransferMaps, rollbackTransferBatch } from "../../../server/src/transferApply.js";
import { listCellComments, upsertCellComment } from "../../../server/src/cellComments.js";
import {
  findKontrByGuid,
  getKontrCardSections,
  listPerimeterKontragents,
  listPerimeterOrganizations,
  updateKontrCardSection,
} from "../../../server/src/nsiPerimeter.js";
import { recommendRashArticles } from "../../../server/src/rashRefs.js";
import { StubDoXmlTransport, listDoInbox } from "../../../server/src/integrations/doXmlAdapter.js";
import {
  MappingTableMinFinExport,
  StubEdsSigningAdapter,
  StubSapConsolidationAdapter,
} from "../../../server/src/integrations/adapters.js";
import { normalizePackageKind } from "../../../server/src/businessProcessTypes.js";
import {
  DtoValidationError,
  parseTransferApplyBody,
} from "../../../server/src/psdDto.js";
import { AdminGuard } from "../auth/admin.guard.js";
import {
  ApiRoleParam,
  ReqUser,
} from "../auth/decorators/oko-request.decorator.js";
import type { SessionUser } from "../../../server/src/users.js";
import type { ApiRole } from "../../../server/src/auth.js";
import { resolvePsdRole } from "../../../server/src/psdRoles.js";
import { loadInstance } from "../../../server/src/instances.js";
import type { OkoDb } from "../../../server/src/oko-db.js";
import {
  PsdPermissionGuard,
  RejectReadOnlyGuard,
  RequirePsdPermissions,
} from "./psd-permission.guard.js";

async function assertCellCommentAccess(
  db: OkoDb,
  instanceId: string,
  user: SessionUser | undefined,
  apiRole: ApiRole | undefined
): Promise<void> {
  const inst = await loadInstance(db, instanceId);
  if (!inst) throw new NotFoundException({ error: "Instance not found" });
  const psd = resolvePsdRole({
    legacyRole: user?.role ?? (apiRole === "admin" ? "admin" : "org"),
    psdRole: user?.psdRole,
  });
  if (psd === "subsidiary_specialist" && user?.zid != null) {
    if (inst.zid == null || Number(inst.zid) !== Number(user.zid)) {
      throw new ForbiddenException({ error: "Access denied for this organization" });
    }
  }
}

@ApiTags("psd-collection-units")
@ApiBearerAuth()
@UseGuards(PsdPermissionGuard, RejectReadOnlyGuard)
@Controller("collection-units")
export class CollectionUnitsController {
  @Get()
  @RequirePsdPermissions("forms.read")
  async list() {
    return listCollectionUnits(await getDb());
  }

  @Put(":zid")
  @RequirePsdPermissions("tech.configure")
  async upsert(
    @Param("zid") zidRaw: string,
    @Body()
    body: {
      name: string;
      code?: string | null;
      parentZid?: number | null;
      unitKind?: CollectionUnitKind;
      headZid?: number | null;
      branchCode?: string | null;
      unitCode?: string | null;
      guid?: string | null;
      headCode?: string | null;
    }
  ) {
    const zid = Number(zidRaw);
    if (!Number.isFinite(zid) || !body?.name) {
      throw new BadRequestException({ error: "zid and name required" });
    }
    return upsertCollectionUnit(await getDb(), { zid, ...body });
  }
}

@ApiTags("psd-kontr-versions")
@ApiBearerAuth()
@UseGuards(PsdPermissionGuard, RejectReadOnlyGuard)
@Controller("kontr-versions")
export class KontrVersionsController {
  @Get(":id")
  @RequirePsdPermissions("nsi.read")
  async versions(@Param("id") idRaw: string) {
    return listKontrVersions(await getDb(), Number(idRaw));
  }

  @Get(":id/at")
  @RequirePsdPermissions("nsi.read")
  async at(@Param("id") idRaw: string, @Query("asOf") asOf?: string) {
    if (!asOf) throw new BadRequestException({ error: "asOf required (YYYY-MM-DD)" });
    return getKontrVersionAt(await getDb(), Number(idRaw), asOf);
  }

  @Post(":id")
  @HttpCode(201)
  @RequirePsdPermissions("nsi.write")
  async createVersion(
    @Param("id") idRaw: string,
    @Body()
    body: {
      validFrom?: string | null;
      validTo?: string | null;
      fields: {
        name: string;
        oldName?: string | null;
        inn?: string | null;
        kpp?: string | null;
        ogrn?: string | null;
        orgForm?: string | null;
        orgType?: number | null;
        mandatoryRash?: boolean;
        country?: string | null;
        city?: string | null;
        idObdnsi?: string | null;
        card?: Record<string, unknown>;
      };
    },
    @ReqUser() user?: SessionUser
  ) {
    if (!body?.fields?.name) throw new BadRequestException({ error: "fields.name required" });
    return createKontrVersion(await getDb(), {
      kontrId: Number(idRaw),
      validFrom: body.validFrom,
      validTo: body.validTo,
      fields: body.fields,
      createdBy: user?.username ?? null,
    });
  }

  @Get(":id/usages")
  @RequirePsdPermissions("nsi.read")
  async usages(@Param("id") idRaw: string) {
    return findKontrUsages(await getDb(), Number(idRaw));
  }

  @Post(":id/archive")
  @HttpCode(200)
  @RequirePsdPermissions("nsi.write")
  async archive(@Param("id") idRaw: string, @Body() body: { force?: boolean }) {
    return archiveKontragent(await getDb(), Number(idRaw), !!body?.force);
  }

  @Get(":id/card")
  @RequirePsdPermissions("nsi.read")
  async card(@Param("id") idRaw: string, @Query("asOf") asOf?: string) {
    return getKontrCardSections(await getDb(), Number(idRaw), asOf);
  }

  @Put(":id/card/:section")
  @RequirePsdPermissions("nsi.write")
  async updateCard(
    @Param("id") idRaw: string,
    @Param("section") section: string,
    @Body() body: { data: Record<string, unknown> },
    @ReqUser() user?: SessionUser
  ) {
    if (!["basic", "requisites", "perimeter"].includes(section)) {
      throw new BadRequestException({ error: "section must be basic|requisites|perimeter" });
    }
    return updateKontrCardSection(await getDb(), {
      kontrId: Number(idRaw),
      section: section as "basic" | "requisites" | "perimeter",
      data: body?.data ?? {},
      actor: user?.username ?? null,
    });
  }
}

@ApiTags("psd-perimeter")
@ApiBearerAuth()
@UseGuards(PsdPermissionGuard, RejectReadOnlyGuard)
@Controller("perimeter")
export class PerimeterController {
  @Get("organizations")
  @RequirePsdPermissions("nsi.read", "forms.read")
  async orgs(
    @Query("q") q?: string,
    @Query("zid") zid?: string,
    @ReqUser() user?: SessionUser,
    @ApiRoleParam() apiRole?: ApiRole
  ) {
    const psd = resolvePsdRole({
      legacyRole: user?.role ?? (apiRole === "admin" ? "admin" : "org"),
      psdRole: user?.psdRole,
    });
    const scopedZid =
      psd === "subsidiary_specialist" && user?.zid != null
        ? user.zid
        : zid
          ? Number(zid)
          : undefined;
    return listPerimeterOrganizations(await getDb(), {
      q,
      zid: scopedZid,
    });
  }

  @Get("kontragents")
  @RequirePsdPermissions("nsi.read")
  async kontragents(
    @Query("q") q?: string,
    @Query("includeArchived") includeArchived?: string
  ) {
    return listPerimeterKontragents(await getDb(), {
      q,
      includeArchived: includeArchived === "1" || includeArchived === "true",
    });
  }

  @Get("kontr-by-guid/:guid")
  @RequirePsdPermissions("nsi.read")
  async byGuid(@Param("guid") guid: string) {
    const row = await findKontrByGuid(await getDb(), guid);
    if (!row) throw new NotFoundException({ error: "Not found" });
    return row;
  }

  @Get("recommended-articles")
  @RequirePsdPermissions("forms.read")
  async articles(@Query("q") q?: string, @Query("group") group?: string) {
    return recommendRashArticles(await getDb(), { q, group, limit: 30 });
  }
}

@ApiTags("psd-checks")
@ApiBearerAuth()
@UseGuards(PsdPermissionGuard, RejectReadOnlyGuard)
@Controller("psd-checks")
export class PsdChecksController {
  @Post("package-run")
  @HttpCode(200)
  @RequirePsdPermissions("forms.read")
  async runPackage(
    @Body() body: { zid: number; eid: number; packageKind?: string },
    @ReqUser() user?: SessionUser
  ) {
    if (!Number.isFinite(Number(body?.zid)) || !Number.isFinite(Number(body?.eid))) {
      throw new BadRequestException({ error: "zid and eid required" });
    }
    return runPackageChecks(await getDb(), {
      zid: Number(body.zid),
      eid: Number(body.eid),
      packageKind: normalizePackageKind(body.packageKind),
      actor: user?.username ?? null,
    });
  }

  @Post("dsl/parse")
  @HttpCode(200)
  @RequirePsdPermissions("forms.read")
  parse(@Body() body: { expression: string }) {
    return parseCheckDsl(body?.expression ?? "");
  }

  @Get("explanations")
  @RequirePsdPermissions("forms.read")
  async explanations(
    @Query("zid") zid: string,
    @Query("eid") eid: string,
    @Query("packageKind") packageKind?: string
  ) {
    return listCheckExplanations(
      await getDb(),
      Number(zid),
      Number(eid),
      normalizePackageKind(packageKind)
    );
  }

  @Post("explanations")
  @HttpCode(201)
  @RequirePsdPermissions("approval.explain")
  async upsertExplanation(
    @Body()
    body: {
      zid: number;
      eid: number;
      packageKind?: string;
      ruleNumber: number;
      formId?: string | null;
      explanation: string;
    },
    @ReqUser() user?: SessionUser
  ) {
    return upsertCheckExplanation(await getDb(), {
      ...body,
      packageKind: normalizePackageKind(body.packageKind),
      author: user?.username ?? null,
    });
  }

  @Post("journal")
  @HttpCode(201)
  @RequirePsdPermissions("forms.read")
  async journal(
    @Body()
    body: {
      zid: number;
      eid: number;
      packageKind?: string;
      results: Array<{
        ruleNumber?: number | null;
        checkType?: string | null;
        passed: boolean;
        leftValue?: number | null;
        rightValue?: number | null;
        message?: string | null;
        formId?: string | null;
        requiresExplanation?: boolean;
      }>;
    },
    @ReqUser() user?: SessionUser
  ) {
    return appendCheckRunJournal(await getDb(), {
      zid: body.zid,
      eid: body.eid,
      packageKind: normalizePackageKind(body.packageKind),
      actor: user?.username ?? null,
      results: body.results ?? [],
    });
  }

  @Get("journal")
  @RequirePsdPermissions("forms.read")
  async listJournal(
    @Query("zid") zid: string,
    @Query("eid") eid: string,
    @Query("packageKind") packageKind?: string,
    @Query("runId") runId?: string
  ) {
    return listCheckJournal(await getDb(), {
      zid: Number(zid),
      eid: Number(eid),
      packageKind: normalizePackageKind(packageKind),
      runId,
    });
  }

  @Get("approval-blockers")
  @RequirePsdPermissions("forms.read")
  async blockers(
    @Query("zid") zid: string,
    @Query("eid") eid: string,
    @Query("packageKind") packageKind?: string
  ) {
    return getApprovalBlockers(
      await getDb(),
      Number(zid),
      Number(eid),
      normalizePackageKind(packageKind)
    );
  }

  @Get("dsl-rules")
  @RequirePsdPermissions("forms.read")
  async listDslRules(@Query("packageKind") packageKind?: string) {
    const { listCheckDslRules } = await import("../../../server/src/checkDslRules.js");
    return listCheckDslRules(await getDb(), packageKind ? normalizePackageKind(packageKind) : undefined);
  }

  @Post("dsl-rules")
  @HttpCode(201)
  @RequirePsdPermissions("tech.configure")
  async upsertDslRule(
    @Body()
    body: {
      code: string;
      expression: string;
      packageKind?: string;
      requiresExplanation?: boolean;
      active?: boolean;
      note?: string | null;
      sortOrder?: number;
    }
  ) {
    const { upsertCheckDslRule } = await import("../../../server/src/checkDslRules.js");
    return upsertCheckDslRule(await getDb(), {
      ...body,
      packageKind: normalizePackageKind(body.packageKind),
    });
  }

  @Post("dsl/run")
  @HttpCode(200)
  @RequirePsdPermissions("forms.read")
  async runDsl(
    @Body() body: { zid: number; eid: number; packageKind?: string },
    @ReqUser() user?: SessionUser
  ) {
    const { runPackageDslChecks } = await import("../../../server/src/checkDslRules.js");
    return runPackageDslChecks(await getDb(), {
      zid: body.zid,
      eid: body.eid,
      packageKind: normalizePackageKind(body.packageKind),
      actor: user?.username ?? null,
    });
  }
}

@ApiTags("psd-support-reports")
@ApiBearerAuth()
@UseGuards(PsdPermissionGuard, RejectReadOnlyGuard)
@Controller("support-reports")
export class SupportReportsController {
  @Get("presets")
  @RequirePsdPermissions("reports.build", "forms.read")
  async presets() {
    const { listSupportReportPresets } = await import("../../../server/src/supportReports.js");
    return listSupportReportPresets(await getDb());
  }

  @Post("run")
  @HttpCode(200)
  @RequirePsdPermissions("reports.build", "forms.read")
  async run(
    @Body() body: { code: string; zid?: number; eid?: number; locale?: "ru" | "en" }
  ) {
    const { runSupportReport } = await import("../../../server/src/supportReports.js");
    try {
      return await runSupportReport(await getDb(), body);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 404) throw new NotFoundException({ error: err.message });
      throw new BadRequestException({ error: err.message });
    }
  }
}

@ApiTags("psd-svods")
@ApiBearerAuth()
@UseGuards(PsdPermissionGuard, RejectReadOnlyGuard)
@Controller("svods")
export class SvodsController {
  @Get()
  @RequirePsdPermissions("forms.read")
  async list(@Query("eid") eid?: string) {
    return listSvodDefinitions(await getDb(), eid ? Number(eid) : undefined);
  }

  @Post()
  @HttpCode(201)
  @RequirePsdPermissions("tech.configure")
  async create(
    @Body()
    body: {
      eid: number;
      packageKind?: string;
      code: string;
      name: string;
      members?: Array<Record<string, unknown>>;
    },
    @ReqUser() user?: SessionUser
  ) {
    return createSvodDefinition(await getDb(), {
      eid: body.eid,
      packageKind: normalizePackageKind(body.packageKind),
      code: body.code,
      name: body.name,
      createdBy: user?.username ?? null,
      members: (body.members ?? []) as never,
    });
  }

  @Get("detail")
  @RequirePsdPermissions("forms.read")
  async detail(
    @Query("zid") zid: string,
    @Query("eid") eid: string,
    @Query("formId") formId?: string
  ) {
    return svodDetailDrilldown(await getDb(), {
      zid: Number(zid),
      eid: Number(eid),
      formId,
    });
  }

  @Post(":id/copy-previous")
  @RequirePsdPermissions("tech.configure")
  async copyPrevious(@Param("id") sourceSvodId: string, @Body() body: { targetEid: number }, @ReqUser() user?: SessionUser) {
    return copySvodFromPreviousPeriod(await getDb(), { sourceSvodId, targetEid: Number(body.targetEid), createdBy: user?.username ?? null });
  }

  @Post(":id/calculate")
  @RequirePsdPermissions("reports.build", "forms.read")
  async calculate(@Param("id") svodId: string, @Body() body: { eid: number; packageKind?: string }) {
    return calculateSvod(await getDb(), { svodId, eid: Number(body.eid), packageKind: normalizePackageKind(body.packageKind) });
  }

  @Get(":id/drill-down")
  @RequirePsdPermissions("forms.read")
  async drillDown(@Param("id") svodId: string, @Query() q: { eid: string; formId: string; rowNo: string; columnKey: string; level?: "058" | "059" | "060" }) {
    return svodDrilldown(await getDb(), { svodId, eid: Number(q.eid), formId: q.formId, rowNo: Number(q.rowNo), columnKey: q.columnKey, level: q.level ?? "058" });
  }
}

@ApiTags("psd-transfers")
@ApiBearerAuth()
@UseGuards(PsdPermissionGuard, RejectReadOnlyGuard)
@Controller("transfers")
export class TransfersController {
  @Get()
  @RequirePsdPermissions("forms.read")
  async list(@Query("kind") kind?: string) {
    return listTransferMaps(await getDb(), kind as TransferMapKind | undefined);
  }

  @Post("bulk")
  @HttpCode(201)
  @UseGuards(AdminGuard)
  @RequirePsdPermissions("tech.configure")
  async bulk(@Body() body: { items: Array<Record<string, unknown>> }) {
    return bulkUpsertTransferMaps(await getDb(), (body.items ?? []) as never);
  }

  @Post("apply")
  @HttpCode(200)
  @RequirePsdPermissions("tech.configure", "forms.write")
  @ApiOperation({ summary: "Применить transfer_maps: копирование числовых ячеек между пакетами" })
  async apply(
    @Body()
    body: Record<string, unknown>,
    @ReqUser() user?: SessionUser
  ) {
    let parsed: ReturnType<typeof parseTransferApplyBody>;
    try {
      parsed = parseTransferApplyBody(body);
    } catch (e) {
      if (e instanceof DtoValidationError) {
        throw new BadRequestException({ error: e.message, issues: e.issues });
      }
      throw e;
    }
    try {
      return await applyTransferMaps(await getDb(), {
        ...parsed,
        actor: user?.username ?? null,
      });
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 409) throw new ConflictException({ error: err.message });
      throw e;
    }
  }

  @Post(":batchId/rollback")
  @RequirePsdPermissions("tech.configure", "forms.write")
  async rollback(@Param("batchId") batchId: string, @ReqUser() user?: SessionUser) {
    return rollbackTransferBatch(await getDb(), batchId, user?.username ?? null);
  }
}

@ApiTags("psd-minfin")
@ApiBearerAuth()
@UseGuards(PsdPermissionGuard, RejectReadOnlyGuard)
@Controller("minfin")
export class MinfinController {
  @Get("mappings")
  @RequirePsdPermissions("forms.read")
  async mappings(@Query("templateName") templateName?: string) {
    return listMinfinMappings(await getDb(), templateName);
  }

  @Post("mappings/bulk")
  @HttpCode(201)
  @RequirePsdPermissions("tech.configure")
  async bulk(@Body() body: { items: Array<Record<string, unknown>> }) {
    return bulkUpsertMinfinMappings(await getDb(), (body.items ?? []) as never);
  }

  @Post("export")
  @HttpCode(200)
  @RequirePsdPermissions("reports.build")
  async export(@Body() body: { eid: number; zid: number; templateName?: string }) {
    if (body?.eid == null || body?.zid == null) {
      throw new BadRequestException({ error: "zid and eid required" });
    }
    const adapter = new MappingTableMinFinExport(await getDb());
    const result = await adapter.export({
      eid: Number(body.eid),
      zid: Number(body.zid),
      templateName: body.templateName?.trim() || "default",
    });
    // Do not send raw Buffer in JSON — base64 only.
    const { buffer: _buf, ...rest } = result as typeof result & { buffer?: Buffer };
    return rest;
  }
}

@ApiTags("psd-cell-comments")
@ApiBearerAuth()
@UseGuards(PsdPermissionGuard, RejectReadOnlyGuard)
@Controller("cell-comments")
export class CellCommentsController {
  @Get()
  @RequirePsdPermissions("forms.read")
  async list(
    @Query("instanceId") instanceId: string,
    @ReqUser() user?: SessionUser,
    @ApiRoleParam() apiRole?: ApiRole
  ) {
    if (!instanceId) throw new BadRequestException({ error: "instanceId required" });
    const db = await getDb();
    await assertCellCommentAccess(db, instanceId, user, apiRole);
    return listCellComments(db, instanceId);
  }

  @Post()
  @HttpCode(201)
  @RequirePsdPermissions("forms.write")
  async upsert(
    @Body()
    body: {
      instanceId: string;
      formId: string;
      rowNo: number;
      columnKey: string;
      amount?: number | null;
      articleCode?: string | null;
      kontrId?: number | null;
      freeText?: string | null;
    },
    @ReqUser() user?: SessionUser,
    @ApiRoleParam() apiRole?: ApiRole
  ) {
    if (!body?.instanceId || !body?.formId || body.rowNo == null || !body.columnKey) {
      throw new BadRequestException({
        error: "instanceId, formId, rowNo, columnKey required",
      });
    }
    const db = await getDb();
    await assertCellCommentAccess(db, body.instanceId, user, apiRole);
    return upsertCellComment(db, {
      ...body,
      author: user?.username ?? null,
    });
  }
}

@ApiTags("psd-integrations")
@ApiBearerAuth()
@UseGuards(PsdPermissionGuard, RejectReadOnlyGuard)
@Controller("integrations")
export class IntegrationsController {
  @Get("status")
  @RequirePsdPermissions("bp.view")
  @ApiOperation({ summary: "Статус портов интеграций (без фиктивных форматов)" })
  async status() {
    const db = await getDb();
    const doXml = new StubDoXmlTransport(db);
    const sap = new StubSapConsolidationAdapter();
    const eds = new StubEdsSigningAdapter();
    const minfin = new MappingTableMinFinExport(db);
    return {
      doXml: { name: doXml.name, configured: doXml.isConfigured() },
      sap: { name: sap.name, configured: sap.isConfigured() },
      eds: { name: eds.name, configured: eds.isConfigured() },
      minfin: { name: minfin.name, configured: minfin.isConfigured() },
      docs: "/docs/PSD-INTEGRATIONS.md",
    };
  }

  @Get("do-inbox")
  @RequirePsdPermissions("bp.view")
  async doInbox() {
    return listDoInbox(await getDb());
  }

  @Post("do-inbox")
  @HttpCode(201)
  @RequirePsdPermissions("forms.write")
  async receiveDo(
    @Body() body: { filename: string; payload: string; sha256?: string },
    @ReqUser() user?: SessionUser
  ) {
    const adapter = new StubDoXmlTransport(await getDb());
    return adapter.receive({
      filename: body.filename,
      payload: body.payload,
      sha256: body.sha256 ?? "",
      actor: user?.username,
    });
  }

  @Post("sap/consolidate")
  @HttpCode(200)
  @RequirePsdPermissions("tech.configure")
  async sap(@Body() body: { eid: number; svodId: string; packageKind?: string }) {
    const adapter = new StubSapConsolidationAdapter();
    return adapter.consolidate({
      eid: body.eid,
      svodId: body.svodId,
      packageKind: normalizePackageKind(body.packageKind),
    });
  }

  @Post("eds/sign")
  @HttpCode(200)
  @RequirePsdPermissions("tech.configure")
  async eds(@Body() body: { filename: string; payloadBase64: string }, @ReqUser() user?: SessionUser) {
    const adapter = new StubEdsSigningAdapter();
    return adapter.sign({
      filename: body.filename,
      payload: Buffer.from(body.payloadBase64 ?? "", "base64"),
      actor: user?.username,
    });
  }
}
