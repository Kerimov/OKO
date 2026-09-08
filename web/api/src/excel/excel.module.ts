import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ExcelController } from "./excel.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [ExcelController],
})
export class ExcelModule {}

