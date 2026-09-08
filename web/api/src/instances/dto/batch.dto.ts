import { ApiProperty } from "@nestjs/swagger";
import { Allow, IsArray } from "class-validator";
import type { OkoFormInstance } from "../../../../domain/src/types.js";

export class InstancesBatchDto {
  @ApiProperty({ type: [Object] })
  @IsArray()
  @Allow()
  instances!: OkoFormInstance[];
}
