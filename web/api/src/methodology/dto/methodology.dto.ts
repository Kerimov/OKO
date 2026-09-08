import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Allow, IsOptional, IsString } from "class-validator";
import type { MethodologyRelease } from "../../../../domain/src/methodology.js";

export class MethodologyDryRunDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  version?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @Allow()
  checksums?: Record<string, string>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @Allow()
  parts?: Record<string, unknown>;
}

export class MethodologyActivateDto implements Partial<MethodologyRelease> {
  @ApiProperty()
  @IsString()
  version!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  exportedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  activatedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  source?: string | null;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @Allow()
  checksums?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @Allow()
  active?: boolean;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @Allow()
  checks?: unknown;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @Allow()
  rash?: unknown;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @Allow()
  recalc?: unknown;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @Allow()
  rowFormulas?: unknown;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @Allow()
  saldo?: unknown;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @Allow()
  correspondence?: unknown;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @Allow()
  kontr?: unknown;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @Allow()
  forms?: unknown;

}

export class MethodologyRollbackDto {
  @ApiProperty()
  @IsString()
  id!: string;
}

export class MethodologySnapshotDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  version?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  source?: string;
}
