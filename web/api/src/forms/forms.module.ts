import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { FormsController } from "./forms.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [FormsController],
})
export class FormsModule {}

