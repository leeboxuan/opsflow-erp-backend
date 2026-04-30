import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { OpsJobsController } from "./ops-jobs.controller";
import { OpsTripsController } from "./ops-trips.controller";
import { DriverJobsController } from "./driver-jobs.controller";
import { DispatchController } from "./dispatch.controller";
import { OpsJobsService } from "./ops-jobs.service";
import { DriverJobsService } from "./driver-jobs.service";
import { DispatchService } from "./dispatch.service";

@Module({
  imports: [PrismaModule, AuthModule, AuditModule],
  controllers: [
    OpsJobsController,
    OpsTripsController,
    DriverJobsController,
    DispatchController,
  ],
  providers: [OpsJobsService, DriverJobsService, DispatchService],
})
export class OpsModule {}
