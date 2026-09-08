import {
  INTEGRATION_CODES,
  type EdsSignRequest,
  type EdsSignResult,
  type EdsSigningPort,
  type SapConsolidationPort,
  type SapConsolidationRequest,
  type SapConsolidationResult,
} from "./ports.js";

export { MappingTableMinFinExport, resolveMinfinTemplatePath, minfinTemplateConfigured } from "../minfinExport.js";

export class StubSapConsolidationAdapter implements SapConsolidationPort {
  readonly name = "stub-sap";

  isConfigured(): boolean {
    return process.env.OKO_SAP_SPEC_CONFIGURED === "1";
  }

  async consolidate(_req: SapConsolidationRequest): Promise<SapConsolidationResult> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        code: INTEGRATION_CODES.SAP_SPEC_MISSING,
        message:
          "SAP consolidation VBA/spec and test fixtures are not provided by customer yet",
      };
    }
    return {
      ok: false,
      code: INTEGRATION_CODES.SAP_SPEC_MISSING,
      message: "SAP adapter configured flag set, but converter implementation is pending",
    };
  }
}

export class StubEdsSigningAdapter implements EdsSigningPort {
  readonly name = "stub-eds";

  isConfigured(): boolean {
    return Boolean(process.env.OKO_EDS_PROVIDER?.trim());
  }

  async sign(_req: EdsSignRequest): Promise<EdsSignResult> {
    return {
      ok: false,
      code: INTEGRATION_CODES.EDS_PROVIDER_NOT_CONFIGURED,
      message:
        "EDS provider is not configured (set OKO_EDS_PROVIDER after customer crypto rules are approved)",
    };
  }
}
