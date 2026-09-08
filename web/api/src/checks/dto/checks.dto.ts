import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsNumber, IsOptional, IsString } from "class-validator";

export class TestCheckExpressionDto {
  @ApiProperty()
  @IsString()
  expression!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  expressionAlt?: string;

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
}
