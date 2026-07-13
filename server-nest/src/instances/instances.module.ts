import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { InstancesController } from "./instances.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [InstancesController],
})
export class InstancesModule {}
