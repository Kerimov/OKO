import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { RequestLogMiddleware } from "../common/request-log.middleware.js";

@Module({})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLogMiddleware).forRoutes("*");
  }
}
