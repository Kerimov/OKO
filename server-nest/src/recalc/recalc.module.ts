import { Module } from "@nestjs/common";
import { RecalcController } from "./recalc.controller.js";

@Module({
  controllers: [RecalcController],
})
export class RecalcModule {}
