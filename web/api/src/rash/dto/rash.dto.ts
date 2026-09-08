import { ApiPropertyOptional } from "@nestjs/swagger";
import { Allow, IsArray, IsBoolean, IsOptional } from "class-validator";
import type {
  RashAddsumDto,
  RashFormAdditionDto,
  RashModalRowDto,
  RashModalSettingsDto,
  RashPlacementDto,
  RashRuleDto,
} from "../../../../domain/src/rash.js";

export class RashBundleDto {
  @ApiPropertyOptional({ type: Object })
  @Allow()
  rule!: RashRuleDto;

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  @Allow()
  addsum?: RashAddsumDto[];

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  @Allow()
  placements?: Array<Omit<RashPlacementDto, "kod"> & { kod?: number }>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @Allow()
  modalSettings?: RashModalSettingsDto;

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  @Allow()
  modalRows?: RashModalRowDto[];

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  @Allow()
  formAdditions?: RashFormAdditionDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  createMissingFormParts?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  forceConflicts?: boolean;
}

export class RashBundlePreviewDto {
  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  @Allow()
  placements?: Array<Omit<RashPlacementDto, "kod"> & { kod?: number }>;

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  @Allow()
  formAdditions?: RashFormAdditionDto[];
}
