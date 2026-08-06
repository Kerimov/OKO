import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import type { OkoFormInstance } from "../../../../server/src/types.js";

export class CreateOrganizationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  parentZid?: number;
}

export class CreatePeriodDto {
  @ApiProperty()
  @IsNumber()
  zid!: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  periodStart?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  periodEnd?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  quarter?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  year?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  methodologyReleaseId?: string | null;

  @ApiPropertyOptional({ enum: ["OKO", "BALANCE"] })
  @IsOptional()
  @IsString()
  packageKind?: "OKO" | "BALANCE";

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  collectionUnitZid?: number | null;
}

export class WorkContextDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  zid?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  eid?: number | null;
}

export class PackageZidEidDto {
  @ApiProperty()
  @IsNumber()
  zid!: number;

  @ApiProperty()
  @IsNumber()
  eid!: number;
}

export class PackageBulkDeleteDto {
  @ApiProperty({ type: [PackageZidEidDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackageZidEidDto)
  items!: PackageZidEidDto[];
}

export class PackageWorkflowPutDto extends PackageZidEidDto {
  @ApiProperty({ enum: ["draft", "submitted", "returned", "corrected", "accepted"] })
  @IsString()
  @IsNotEmpty()
  status!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  comment?: string | null;

  @ApiPropertyOptional({ description: "Admin: skip completeness gates" })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class PackageImportDto extends PackageZidEidDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  overwrite?: boolean;

  /** PartReceiveZID: accept only these forms (omit = all). */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  templateIds?: string[];

  @ApiProperty()
  package!: {
    organization?: string;
    periodStart?: string;
    periodEnd?: string;
    instances: OkoFormInstance[];
  };
}

export class PackageConstructTargetDto {
  @ApiProperty()
  @IsNumber()
  zid!: number;
}

export class PackageConstructPeriodDto {
  @ApiPropertyOptional({ description: "Derived from quarter+year when omitted" })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  periodStart?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  periodEnd?: string;

  @ApiPropertyOptional({ description: "Отчётный квартал 1–4" })
  @IsOptional()
  @IsNumber()
  quarter?: number;

  @ApiPropertyOptional({ description: "Отчётный год" })
  @IsOptional()
  @IsNumber()
  year?: number;

  @ApiPropertyOptional({ enum: ["OKO", "BALANCE"] })
  @IsOptional()
  @IsString()
  packageKind?: "OKO" | "BALANCE";

  @ApiPropertyOptional({ description: "Reuse existing period with same quarter+year+kind" })
  @IsOptional()
  @IsBoolean()
  reuseExisting?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  methodologyReleaseId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  collectionUnitZid?: number | null;
}

export class PackageConstructFormsDto {
  @ApiProperty({ enum: ["all", "selected"] })
  @IsString()
  @IsNotEmpty()
  mode!: "all" | "selected";

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  formIds?: string[];
}

export class PackageConstructOptionsDto {
  @ApiPropertyOptional({ description: "Create empty form instances (default true)" })
  @IsOptional()
  @IsBoolean()
  createInstances?: boolean;

  @ApiPropertyOptional({ description: "Continue bulk on per-row errors (default true)" })
  @IsOptional()
  @IsBoolean()
  continueOnError?: boolean;
}

export class PackageConstructDto {
  @ApiProperty({ enum: ["single", "bulk"] })
  @IsString()
  @IsNotEmpty()
  mode!: "single" | "bulk";

  @ApiProperty({ type: [PackageConstructTargetDto] })
  @IsArray()
  targets!: PackageConstructTargetDto[];

  @ApiProperty({ type: PackageConstructPeriodDto })
  period!: PackageConstructPeriodDto;

  @ApiProperty({ type: PackageConstructFormsDto })
  forms!: PackageConstructFormsDto;

  @ApiPropertyOptional({ type: PackageConstructOptionsDto })
  @IsOptional()
  options?: PackageConstructOptionsDto;
}

export class CreateUserDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  username!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  password!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional({ enum: ["admin", "org"] })
  @IsOptional()
  @IsString()
  role?: "admin" | "org";

  @ApiPropertyOptional({
    enum: [
      "business_process_manager",
      "department_curator",
      "subsidiary_specialist",
      "support_specialist",
      "auditor_readonly",
    ],
  })
  @IsOptional()
  @IsString()
  psdRole?:
    | "business_process_manager"
    | "department_curator"
    | "subsidiary_specialist"
    | "support_specialist"
    | "auditor_readonly";

  @ApiPropertyOptional({ enum: ["ru", "en"] })
  @IsOptional()
  @IsString()
  locale?: "ru" | "en";

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  zid?: number | null;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  displayName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional({ enum: ["admin", "org"] })
  @IsOptional()
  @IsString()
  role?: "admin" | "org";

  @ApiPropertyOptional({
    enum: [
      "business_process_manager",
      "department_curator",
      "subsidiary_specialist",
      "support_specialist",
      "auditor_readonly",
    ],
  })
  @IsOptional()
  @IsString()
  psdRole?:
    | "business_process_manager"
    | "department_curator"
    | "subsidiary_specialist"
    | "support_specialist"
    | "auditor_readonly";

  @ApiPropertyOptional({ enum: ["ru", "en"] })
  @IsOptional()
  @IsString()
  locale?: "ru" | "en";

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  zid?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
