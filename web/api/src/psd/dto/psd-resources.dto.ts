import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  Allow,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

export class UpsertCollectionUnitDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  code?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  parentZid?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unitKind?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  headZid?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  branchCode?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  unitCode?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  guid?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  headCode?: string | null;
}

export class KontrVersionFieldsDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  oldName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  inn?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  kpp?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  ogrn?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  orgForm?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  orgType?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  mandatoryRash?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  country?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  city?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  idObdnsi?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Allow()
  card?: Record<string, unknown>;
}

export class CreateKontrVersionDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  validFrom?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  validTo?: string | null;

  @ApiProperty({ type: KontrVersionFieldsDto })
  @ValidateNested()
  @Type(() => KontrVersionFieldsDto)
  fields!: KontrVersionFieldsDto;
}

export class ArchiveKontrDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class UpdateKontrCardDto {
  @ApiProperty()
  @Allow()
  data!: Record<string, unknown>;
}

export class PackageZidEidKindDto {
  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  zid!: number;

  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  eid!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  packageKind?: string;
}

export class ParseCheckDslDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  expression!: string;
}

export class UpsertCheckExplanationDto {
  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  zid!: number;

  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  eid!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  packageKind?: string;

  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  ruleNumber!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  formId?: string;

  @ApiProperty()
  @IsString()
  explanation!: string;
}

export class CheckJournalResultItemDto {
  @ApiProperty()
  @Allow()
  result!: unknown;
}

export class AppendCheckJournalDto {
  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  zid!: number;

  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  eid!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  packageKind?: string;

  @ApiProperty({ type: [Object] })
  @IsArray()
  @Allow()
  results!: unknown[];
}

export class UpsertCheckDslRuleDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty()
  @IsString()
  expression!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  packageKind?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresExplanation?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  sortOrder?: number;
}

export class RunSupportReportDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  zid?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  eid?: number;

  @ApiPropertyOptional({ enum: ["ru", "en"] })
  @IsOptional()
  @IsIn(["ru", "en"])
  locale?: "ru" | "en";
}

export class CreateSvodDefinitionDto {
  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  eid!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  packageKind?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  @Allow()
  members?: Array<Record<string, unknown>>;
}

export class CopySvodPreviousDto {
  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  targetEid!: number;
}

export class CalculateSvodDto {
  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  eid!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  packageKind?: string;
}

export class BulkItemsDto {
  @ApiProperty({ type: [Object] })
  @IsArray()
  @Allow()
  items!: Array<Record<string, unknown>>;
}

export class TransferApplyDto {
  @ApiProperty({ enum: ["period_to_period", "balance_to_oko", "oko_to_balance"] })
  @IsIn(["period_to_period", "balance_to_oko", "oko_to_balance"])
  kind!: "period_to_period" | "balance_to_oko" | "oko_to_balance";

  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  sourceZid!: number;

  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  sourceEid!: number;

  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  targetZid!: number;

  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  targetEid!: number;

  @ApiPropertyOptional({ enum: ["OKO", "BALANCE"] })
  @IsOptional()
  @IsIn(["OKO", "BALANCE"])
  packageKind?: "OKO" | "BALANCE";

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class MinfinExportDto {
  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  eid!: number;

  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  zid!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  templateName?: string;
}

export class UpsertCellCommentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  instanceId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  formId!: string;

  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  rowNo!: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  columnKey!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  articleCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  kontrId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  freeText?: string;
}

export class ReceiveDoInboxDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  filename!: string;

  @ApiProperty()
  @IsString()
  payload!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sha256?: string;
}

export class SapConsolidateDto {
  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  eid!: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  svodId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  packageKind?: string;
}

export class EdsSignDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  filename!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  payloadBase64!: string;
}
