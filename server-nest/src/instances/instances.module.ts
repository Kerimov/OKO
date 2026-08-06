import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { InstancesController } from "./instances.controller.js";
import { PsdPermissionGuard } from "../auth/psd-permission.guard.js";

@Module({
  imports: [AuthModule],
  controllers: [InstancesController],
  providers: [PsdPermissionGuard],
})
export class InstancesModule {}
