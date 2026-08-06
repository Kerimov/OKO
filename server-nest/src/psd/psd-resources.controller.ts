import {
  BadRequestException,
  Body,
  Controller,
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
import {
  createSvodDefinition,
  listSvodDefinitions,
  svodDetailDrilldown,
} from "../../../server/src/svodRegistry.js";
import {
  bulkUpsertMinfinMappings,
  bulkUpsertTransferMaps,
  listMinfinMappings,
  listTransferMaps,
  type TransferMapKind,
} from "../../../server/src/transferMaps.js";
import { applyTransferMaps } from "../../../server/src/transferApply.js";
import { listCellComments, upsertCellComment } from "../../../server/src/cellComments.js";
import { StubDoXmlTransport, listDoInbox } from "../../../server/src/integrations/doXmlAdapter.js";
import {
  MappingTableMinFinExport,
  StubEdsSigningAdapter,
  StubSapConsolidationAdapter,
} from "../../../server/src/integrations/adapters.js";
import { normalizePackageKind } from "../../../server/src/businessProcessTypes.js";
import { AdminGuard } from "../auth/admin.guard.js";
import { ReqUser } from "../auth/decorators/oko-request.decorator.js";
import type { SessionUser } from "../../../server/src/users.js";
import {
  PsdPermissionGuard,
  RejectReadOnlyGuard,
  RequirePsdPermissions,
} from "./psd-permission.guard.js";

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
}

@ApiTags("psd-checks")
@ApiBearerAuth()
@UseGuards(PsdPermissionGuard, RejectReadOnlyGuard)
@Controller("psd-checks")
export class PsdChecksController {
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
    body: {
      kind: TransferMapKind;
      sourceZid: number;
      sourceEid: number;
      targetZid: number;
      targetEid: number;
    },
    @ReqUser() user?: SessionUser
  ) {
    if (!body?.kind || body.sourceZid == null || body.sourceEid == null || body.targetZid == null || body.targetEid == null) {
      throw new BadRequestException({
        error: "kind, sourceZid, sourceEid, targetZid, targetEid required",
      });
    }
    return applyTransferMaps(await getDb(), {
      kind: body.kind,
      sourceZid: Number(body.sourceZid),
      sourceEid: Number(body.sourceEid),
      targetZid: Number(body.targetZid),
      targetEid: Number(body.targetEid),
      actor: user?.username ?? null,
    });
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
  async list(@Query("instanceId") instanceId: string) {
    if (!instanceId) throw new BadRequestException({ error: "instanceId required" });
    return listCellComments(await getDb(), instanceId);
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
    @ReqUser() user?: SessionUser
  ) {
    return upsertCellComment(await getDb(), {
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
