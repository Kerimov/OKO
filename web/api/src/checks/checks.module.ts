import { Module } from "@nestjs/common";
import { ChecksController } from "./checks.controller.js";

@Module({
  controllers: [ChecksController],
})
export class ChecksModule {}
