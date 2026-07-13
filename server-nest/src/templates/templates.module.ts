import { Module } from "@nestjs/common";
import { TemplatesController } from "./templates.controller.js";

@Module({
  controllers: [TemplatesController],
})
export class TemplatesModule {}
