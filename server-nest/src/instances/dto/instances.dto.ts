import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString } from "class-validator";

export class InstanceStatusDto {
  @ApiProperty({ enum: ["draft", "submitted"] })
  @IsString()
  @IsIn(["draft", "submitted"])
  status!: "draft" | "submitted";
}

export class InstanceRunChecksDto {
  @ApiPropertyOptional({ enum: ["period", "active", "all"], default: "period" })
  @IsOptional()
  @IsIn(["period", "active", "all"])
  mode?: "period" | "active" | "all";
}

export class InstanceRashPutDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  formId?: string;

  @ApiPropertyOptional({ type: "array", items: { type: "object" } })
  @IsOptional()
  entries?: Record<string, unknown>[];
}

export class InstanceMigrateDto {
  @ApiPropertyOptional({ type: "array", items: { type: "object" } })
  @IsOptional()
  instances?: Record<string, unknown>[];

  @ApiPropertyOptional({ type: "object", additionalProperties: { type: "string" } })
  @IsOptional()
  settings?: Record<string, string>;
}
