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

export class CreateFormDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cloneFrom?: string;
}

export class UpdateFormMetaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  pages?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  pdfFile?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowAddRows?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  kontrForm?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  signatures?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  archived?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  schemaVersion?: number;
}

export class ArchiveFormDto {
  @ApiPropertyOptional({ description: "false = разархивировать" })
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class FormColumnItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  key!: string;

  @ApiProperty()
  @IsString()
  label!: string;

  @ApiProperty({ enum: ["text", "number"] })
  @IsIn(["text", "number"])
  type!: "text" | "number";

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  width?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  frozen?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  readonly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  fTotal?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  helpText?: string | null;

  @ApiPropertyOptional({ enum: ["left", "center", "right"], nullable: true })
  @IsOptional()
  @IsIn(["left", "center", "right"])
  align?: "left" | "center" | "right" | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  decimals?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hidden?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  formula?: string | null;
}

export class FormRowItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  num?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  code?: string;

  @ApiProperty()
  @IsString()
  name!: string;

  @ApiPropertyOptional({
    enum: ["data", "header", "total", "section", "hidden"],
    nullable: true,
  })
  @IsOptional()
  @IsIn(["data", "header", "total", "section", "hidden"])
  kind?: "data" | "header" | "total" | "section" | "hidden" | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  level?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  readonly?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  formula?: string | null;
}

export class UpsertCellDefinitionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  rowId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  columnKey!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  formulaA1?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  formulaStable?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  readonly?: boolean;

  @ApiPropertyOptional({ description: "Произвольный JSON стиля" })
  @IsOptional()
  @Allow()
  style?: unknown;

  @ApiPropertyOptional({ description: "Произвольный JSON валидации" })
  @IsOptional()
  @Allow()
  validation?: unknown;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  numberFormat?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  helpText?: string | null;
}

export class RenameFormColumnDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  fromKey!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  toKey!: string;
}

export class FormSchemaMetaDto {
  @ApiProperty()
  @IsString()
  organization!: string;

  @ApiProperty()
  @IsString()
  enterpriseCode!: string;

  @ApiProperty()
  @IsString()
  periodStart!: string;

  @ApiProperty()
  @IsString()
  periodEnd!: string;

  @ApiProperty()
  @IsString()
  unit!: string;
}

export class ReplaceFormSchemaDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string;

  @ApiProperty()
  @IsString()
  title!: string;

  @ApiProperty()
  @IsString()
  category!: string;

  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  pages!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pdfFile?: string;

  @ApiProperty({ type: FormSchemaMetaDto })
  @ValidateNested()
  @Type(() => FormSchemaMetaDto)
  meta!: FormSchemaMetaDto;

  @ApiProperty({ type: [FormColumnItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FormColumnItemDto)
  columns!: FormColumnItemDto[];

  @ApiProperty({ type: [FormRowItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FormRowItemDto)
  rows!: FormRowItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowAddRows?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  kontrForm?: boolean;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  signatures!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  archived?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  schemaVersion?: number;
}
