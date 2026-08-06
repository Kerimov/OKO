import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth.controller.js";
import { AuthGuard } from "./auth.guard.js";
import { AdminGuard } from "./admin.guard.js";
import { RejectReadOnlyGuard } from "./reject-readonly.guard.js";
import { PsdPermissionGuard } from "./psd-permission.guard.js";

@Module({
  controllers: [AuthController],
  providers: [
    AuthGuard,
    AdminGuard,
    RejectReadOnlyGuard,
    PsdPermissionGuard,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RejectReadOnlyGuard },
  ],
  exports: [AdminGuard, RejectReadOnlyGuard, PsdPermissionGuard],
})
export class AuthModule {}
