import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
} from "class-validator";

export class InboxReceiveDto {
  @ApiPropertyOptional({ description: "Сырой JSON комплекта" })
  @IsOptional()
  @IsString()
  rawJson?: string;

  @ApiPropertyOptional({ description: "Уже распарсенный объект ReportPackage" })
  @IsOptional()
  package?: unknown;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  filename?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  targetZid?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  targetEid?: number;
}

export class InboxRejectDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class InboxAcceptDto {
  @ApiProperty()
  @IsNumber()
  zid!: number;

  @ApiProperty()
  @IsNumber()
  eid!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  overwrite?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  templateIds?: string[];
}
