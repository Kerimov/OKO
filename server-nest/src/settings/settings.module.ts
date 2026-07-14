import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { SettingsController } from "./settings.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [SettingsController],
})
export class SettingsModule {}
