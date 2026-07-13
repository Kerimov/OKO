import { Module } from "@nestjs/common";
import { RashController } from "./rash.controller.js";

@Module({
  controllers: [RashController],
})
export class RashModule {}
