import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { OpsJobsController } from "./ops-jobs.controller";
import { DriverJobsController } from "./driver-jobs.controller";
import { OpsJobsService } from "./ops-jobs.service";
import { DriverJobsService } from "./driver-jobs.service";

@Module({
  imports: [PrismaModule, AuthModule, AuditModule],
  controllers: [OpsJobsController, DriverJobsController],
  providers: [OpsJobsService, DriverJobsService],
})
export class OpsModule {}
