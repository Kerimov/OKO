import { Global, Injectable, Logger, Module, OnModuleInit } from "@nestjs/common";

@Injectable()
export class DatabaseService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseService.name);

  async onModuleInit(): Promise<void> {
    this.logger.log("Database ready");
  }
}

@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
