import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { BusinessProcessesController } from "./business-processes.controller.js";
import {
  CellCommentsController,
  CollectionUnitsController,
  IntegrationsController,
  KontrVersionsController,
  MinfinController,
  PerimeterController,
  PsdChecksController,
  SupportReportsController,
  SvodsController,
  TransfersController,
} from "./psd-resources.controller.js";
import { PsdPermissionGuard } from "./psd-permission.guard.js";
import { RejectReadOnlyGuard } from "../auth/reject-readonly.guard.js";
import { RolesController } from "./roles.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [
    RolesController,
    BusinessProcessesController,
    CollectionUnitsController,
    KontrVersionsController,
    PerimeterController,
    PsdChecksController,
    SupportReportsController,
    SvodsController,
    TransfersController,
    MinfinController,
    CellCommentsController,
    IntegrationsController,
  ],
  providers: [PsdPermissionGuard, RejectReadOnlyGuard],
})
export class PsdModule {}
