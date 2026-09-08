import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AuditController } from "./audit.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [AuditController],
})
export class AuditModule {}

