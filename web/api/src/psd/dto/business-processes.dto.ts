import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsNumber, IsOptional, IsString } from "class-validator";
import type { BpAction } from "../../../../domain/src/businessProcess.js";

export class EnsureBusinessProcessDto {
  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  zid!: number;

  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  eid!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  packageKind?: string;
}

export class TransitionBusinessProcessDto {
  @ApiProperty({ enum: ["start", "submit_for_approval", "curator_approve", "curator_return", "complete", "reopen"] })
  @IsIn(["start", "submit_for_approval", "curator_approve", "curator_return", "complete", "reopen"])
  action!: BpAction;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class AssignCuratorDto {
  @ApiProperty({ nullable: true })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  curatorUserId!: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  deadlineAt?: string | null;
}
