import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrganizationsController } from "./organizations.controller.js";
import { PackagesController } from "./packages.controller.js";
import { PeriodsController } from "./periods.controller.js";
import { WorkContextController } from "./work-context.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [
    OrganizationsController,
    PeriodsController,
    WorkContextController,
    PackagesController,
  ],
})
export class PackagesModule {}
