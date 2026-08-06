/**
 * Integration ports for PSD external systems.
 * Concrete adapters must not invent customer formats — see docs/PSD-INTEGRATIONS.md.
 */

export type PackageKind = "OKO" | "BALANCE";

export interface DoXmlReceiveInput {
  filename: string;
  payload: string;
  sha256: string;
  actor?: string;
}

export interface DoXmlReceiveResult {
  id: string;
  status: "received" | "rejected" | "imported";
  validationErrors: string[];
  zid?: number;
  eid?: number;
  packageKind?: PackageKind;
}

export interface DoXmlTransportPort {
  readonly name: string;
  /** Returns false until customer XSD/reglament is configured. */
  isConfigured(): boolean;
  receive(input: DoXmlReceiveInput): Promise<DoXmlReceiveResult>;
}

export interface SapConsolidationRequest {
  eid: number;
  svodId: string;
  packageKind: PackageKind;
}

export interface SapConsolidationResult {
  ok: boolean;
  code: string;
  message: string;
  artifactPath?: string;
}

export interface SapConsolidationPort {
  readonly name: string;
  isConfigured(): boolean;
  consolidate(req: SapConsolidationRequest): Promise<SapConsolidationResult>;
}

export interface MinFinExportRequest {
  eid: number;
  zid: number;
  templateName: string;
}

export interface MinFinExportResult {
  ok: boolean;
  code: string;
  message: string;
  mappingCount: number;
  buffer?: Buffer;
}

export interface MinFinExportPort {
  readonly name: string;
  isConfigured(): boolean;
  export(req: MinFinExportRequest): Promise<MinFinExportResult>;
}

export interface EdsSignRequest {
  payload: Buffer;
  filename: string;
  actor?: string;
}

export interface EdsSignResult {
  ok: boolean;
  code: string;
  message: string;
  signature?: Buffer;
  detached?: boolean;
}

export interface EdsSigningPort {
  readonly name: string;
  isConfigured(): boolean;
  sign(req: EdsSignRequest): Promise<EdsSignResult>;
}

export const INTEGRATION_CODES = {
  DO_XSD_MISSING: "DO_XSD_MISSING",
  SAP_SPEC_MISSING: "SAP_SPEC_MISSING",
  MINFIN_MAPPINGS_EMPTY: "MINFIN_MAPPINGS_EMPTY",
  EDS_PROVIDER_NOT_CONFIGURED: "EDS_PROVIDER_NOT_CONFIGURED",
} as const;
