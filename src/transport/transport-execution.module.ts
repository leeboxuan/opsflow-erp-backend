import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../shared/audit/audit.module";
import { OpsJobsController } from "./jobs/ops-jobs.controller";
import { OpsTripsController } from "./trips/ops-trips.controller";
import { DriverJobsController } from "./driver-app/driver-jobs.controller";
import { DriverHomeController } from "./driver-app/driver-home.controller";
import { DriverTripsController } from "./driver-app/driver-trips.controller";
import { DispatchController } from "./dispatch/dispatch.controller";
import { OpsJobsService } from "./jobs/ops-jobs.service";
import { DriverJobsService } from "./driver-app/driver-jobs.service";
import { DispatchService } from "./dispatch/dispatch.service";
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
export class TransportExecutionModule {}
