import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth.controller.js";
import { AuthGuard } from "./auth.guard.js";
import { AdminGuard } from "./admin.guard.js";

@Module({
  controllers: [AuthController],
  providers: [AuthGuard, AdminGuard, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AdminGuard],
})
export class AuthModule {}
