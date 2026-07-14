import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
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

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  zid?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
