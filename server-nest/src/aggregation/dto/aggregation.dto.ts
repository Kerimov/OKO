import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString } from "class-validator";

export class AggListUpsertDto {
  @ApiProperty()
  @IsNumber()
  parentZid!: number;

  @ApiProperty()
  @IsNumber()
  childZid!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  included?: boolean;
}

export class RunAggregationDto {
  @ApiProperty()
  @IsNumber()
  parentZid!: number;

  @ApiProperty()
  @IsNumber()
  eid!: number;

  @ApiPropertyOptional({ description: "Участники свода (переопределение Include?)" })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  childZids?: number[];

  @ApiPropertyOptional({ description: "Подмножество форм; по умолчанию весь каталог" })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  formIds?: string[];

  @ApiPropertyOptional({
    description: "Суммировать форму только если есть данные у всех выбранных участников",
  })
  @IsOptional()
  @IsBoolean()
  requireAllChildren?: boolean;

  @ApiPropertyOptional({ description: "Пересчёт итогов после свода (по умолчанию true)" })
  @IsOptional()
  @IsBoolean()
  recalc?: boolean;

  @ApiPropertyOptional({
    description:
      "Режим свода: full = AggregateSet; green/yellow/red/blue = AggrSetReorg* по маске FormCorrespondence",
    enum: ["full", "green", "yellow", "red", "blue"],
  })
  @IsOptional()
  @IsIn(["full", "green", "yellow", "red", "blue"])
  colorMode?: "full" | "green" | "yellow" | "red" | "blue";

  @ApiPropertyOptional({
    description:
      "Режим реорганизации (btnReorg): в цветовом режиме пропускать формы без ReorgUpdate",
  })
  @IsOptional()
  @IsBoolean()
  reorg?: boolean;

  @ApiPropertyOptional({
    description:
      "AggrGreenUpdate: обновить маску на существующем родительском комплекте, сохранив ячейки вне маски",
  })
  @IsOptional()
  @IsBoolean()
  updateCorrSet?: boolean;

  @ApiPropertyOptional({
    description: "Куда писать свод (k_zid / корректирующий набор). По умолчанию = parentZid",
  })
  @IsOptional()
  @IsNumber()
  targetZid?: number;

  @ApiPropertyOptional({
    description:
      "Включать черновики участников. По умолчанию false — только формы со статусом «сдано»",
  })
  @IsOptional()
  @IsBoolean()
  includeDraftSources?: boolean;

  @ApiPropertyOptional({
    description:
      "Разрешить перезапись уже сданной целевой формы. По умолчанию false",
  })
  @IsOptional()
  @IsBoolean()
  overwriteSubmitted?: boolean;
}

export class CreateCorrSetDto {
  @ApiProperty()
  @IsNumber()
  parentZid!: number;

  @ApiProperty()
  @IsNumber()
  eid!: number;

  @ApiPropertyOptional({ enum: ["correct", "mirror"] })
  @IsOptional()
  @IsIn(["correct", "mirror"])
  kind?: "correct" | "mirror";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;
}

export class ValidateAccountRowsDto {
  @ApiProperty()
  @IsNumber()
  parentZid!: number;

  @ApiProperty()
  @IsNumber()
  eid!: number;

  @ApiPropertyOptional({ description: "Пакет для проверки (k_zid); по умолчанию parentZid" })
  @IsOptional()
  @IsNumber()
  targetZid?: number;

  @ApiPropertyOptional({ description: "N01_01 и/или N01_02" })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  forms?: string[];
}

export class FillBalanceRowsDto {
  @ApiProperty()
  @IsNumber()
  parentZid!: number;

  @ApiProperty()
  @IsNumber()
  eid!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  targetZid?: number;

  @ApiPropertyOptional({ enum: ["ifEmpty", "overwrite"] })
  @IsOptional()
  @IsIn(["ifEmpty", "overwrite"])
  mode?: "ifEmpty" | "overwrite";

  @ApiPropertyOptional({
    description: "Разрешить изменение сданной формы N01_1. По умолчанию false",
  })
  @IsOptional()
  @IsBoolean()
  overwriteSubmitted?: boolean;
}
