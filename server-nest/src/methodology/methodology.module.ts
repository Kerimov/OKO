import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { MethodologyController } from "./methodology.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [MethodologyController],
})
export class MethodologyModule {}
