import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { KontrController } from "./kontr.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [KontrController],
})
export class KontrModule {}
