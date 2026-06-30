import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../shared/audit/audit.module";
import { OpsJobsController } from "./ops-jobs.controller";
import { OpsTripsController } from "./ops-trips.controller";
import { DriverJobsController } from "./driver-jobs.controller";
import { DriverHomeController } from "./driver-home.controller";
import { DriverTripsController } from "./driver-trips.controller";
import { DispatchController } from "./dispatch.controller";
import { OpsJobsService } from "./ops-jobs.service";
import { DriverJobsService } from "./driver-jobs.service";
import { DispatchService } from "./dispatch.service";
import { FinanceModule } from "../finance/finance.module";

@Module({
  imports: [PrismaModule, AuthModule, AuditModule, FinanceModule],
  controllers: [
    OpsJobsController,
    OpsTripsController,
    DriverJobsController,
    DriverHomeController,
    DriverTripsController,
    DispatchController,
  ],
  providers: [OpsJobsService, DriverJobsService, DispatchService],
})
export class OpsModule {}
