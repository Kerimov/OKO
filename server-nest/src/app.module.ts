import { Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { HealthModule } from "./health/health.module.js";
import { InstancesModule } from "./instances/instances.module.js";
import { PackagesModule } from "./packages/packages.module.js";
import { SettingsModule } from "./settings/settings.module.js";
import { UsersModule } from "./users/users.module.js";
import { ChecksModule } from "./checks/checks.module.js";
import { AggregationModule } from "./aggregation/aggregation.module.js";
import { RashModule } from "./rash/rash.module.js";
import { KontrModule } from "./kontr/kontr.module.js";
import { FormsModule } from "./forms/forms.module.js";
import { SaldoModule } from "./saldo/saldo.module.js";
import { ExcelModule } from "./excel/excel.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { RecalcModule } from "./recalc/recalc.module.js";
import { TemplatesModule } from "./templates/templates.module.js";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    HealthModule,
    InstancesModule,
    SettingsModule,
    PackagesModule,
    UsersModule,
    ChecksModule,
    AggregationModule,
    RashModule,
    KontrModule,
    FormsModule,
    SaldoModule,
    ExcelModule,
    AuditModule,
    RecalcModule,
    TemplatesModule,
  ],
})
export class AppModule {}

