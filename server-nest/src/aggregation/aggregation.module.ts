import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AggregationController } from "./aggregation.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [AggregationController],
})
export class AggregationModule {}
