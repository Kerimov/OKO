import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsNumber, IsOptional } from "class-validator";

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
}
