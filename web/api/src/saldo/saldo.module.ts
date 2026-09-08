import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { SaldoController } from "./saldo.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [SaldoController],
})
export class SaldoModule {}

