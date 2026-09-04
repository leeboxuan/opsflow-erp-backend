import { Module } from "@nestjs/common";
import { PrismaModule } from "../shared/prisma/prisma.module";
import { AuthModule } from "../shared/auth/auth.module";
import { AuditModule } from "../shared/audit/audit.module";
import { PlacesModule } from "../shared/places/places.module";
import { TransportJobsController } from "./jobs/transport-jobs.controller";
import { TransportTripsController } from "./trips/transport-trips.controller";
import { DriverJobsController } from "./driver-app/driver-jobs.controller";
import { DriverTripExpensesController } from "./driver-app/driver-trip-expenses.controller";
import { DriverHomeController } from "./driver-app/driver-home.controller";
import { DriverTripsController } from "./driver-app/driver-trips.controller";
import { DispatchController } from "./dispatch/dispatch.controller";
import { TransportJobsService } from "./jobs/transport-jobs.service";
import { JobMessageImportService } from "./jobs/message-import/job-message-import.service";
import { DriverJobsService } from "./driver-app/driver-jobs.service";
import { DispatchService } from "./dispatch/dispatch.service";
import { DispatchRoutePlanningService } from "./dispatch/dispatch-route-planning.service";
import { FinanceModule } from "./finance/finance.module";
import { DriversModule } from "./drivers/drivers.module";
import { JOB_MESSAGE_PARSER_TOKEN } from "./jobs/message-import/job-message-import.constants";
import { createJobMessageParser } from "./jobs/message-import/job-message-parser.factory";

@Module({
  imports: [PrismaModule, AuthModule, AuditModule, FinanceModule, DriversModule, PlacesModule],
  controllers: [
    TransportJobsController,
    TransportTripsController,
    DriverJobsController,
    DriverTripExpensesController,
    DriverHomeController,
    DriverTripsController,
    DispatchController,
  ],
  providers: [
    TransportJobsService,
    DriverJobsService,
    DispatchService,
    DispatchRoutePlanningService,
    JobMessageImportService,
    {
      provide: JOB_MESSAGE_PARSER_TOKEN,
      useFactory: () => createJobMessageParser(),
    },
  ],
})
export class TransportExecutionModule {}
