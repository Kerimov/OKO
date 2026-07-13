import "reflect-metadata";
import "../../server/src/env.js";
import express from "express";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger, ValidationPipe } from "@nestjs/common";
import { bootstrapDatabase } from "../../server/src/db.js";
import { isPostgresMode } from "../../server/src/oko-db.js";
import { mountLegacyApi } from "../../server/src/legacy-routes.js";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const logger = new Logger("Bootstrap");
  await bootstrapDatabase();

  const expressApp = express();
  mountLegacyApi(expressApp);

  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp), {
    bodyParser: false,
    logger: ["error", "warn", "log"],
  });

  app.setGlobalPrefix("api");
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    })
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle("OKO API")
    .setDescription("ПК ОКО — REST API (NestJS, миграция с Express)")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/docs", app, document);

  await app.init();

  const port = Number(process.env.PORT ?? 3001);
  process.env.OKO_RUNTIME = "nestjs";
  await app.listen(port);

  const dialect = isPostgresMode() ? "postgresql" : "sqlite";
  logger.log(`OKO API (NestJS) http://localhost:${port} (${dialect})`);
  logger.log(`Swagger: http://localhost:${port}/api/docs`);
}

bootstrap().catch((err) => {
  console.error("Failed to start OKO NestJS API:", err);
  process.exit(1);
});
