import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { BusinessProcessesController } from "./business-processes.controller.js";
import {
  CellCommentsController,
  CollectionUnitsController,
  IntegrationsController,
  KontrVersionsController,
  MinfinController,
  PsdChecksController,
  SupportReportsController,
  SvodsController,
  TransfersController,
} from "./psd-resources.controller.js";
import { PsdPermissionGuard } from "./psd-permission.guard.js";
import { RejectReadOnlyGuard } from "../auth/reject-readonly.guard.js";

@Module({
  imports: [AuthModule],
  controllers: [
    BusinessProcessesController,
    CollectionUnitsController,
    KontrVersionsController,
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
