import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { KontrController } from "./kontr.controller.js";
import { PsdPermissionGuard } from "../auth/psd-permission.guard.js";

@Module({
  imports: [AuthModule],
  controllers: [KontrController],
  providers: [PsdPermissionGuard],
})
export class KontrModule {}
