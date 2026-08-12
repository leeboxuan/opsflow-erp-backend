import { Module } from "@nestjs/common";
import { PrismaModule } from "../shared/prisma/prisma.module";
import { AuthModule } from "../shared/auth/auth.module";
import { AuditModule } from "../shared/audit/audit.module";
import { TransportJobsController } from "./jobs/transport-jobs.controller";
import { TransportTripsController } from "./trips/transport-trips.controller";
import { DriverJobsController } from "./driver-app/driver-jobs.controller";
import { DriverHomeController } from "./driver-app/driver-home.controller";
import { DriverTripsController } from "./driver-app/driver-trips.controller";
import { DispatchController } from "./dispatch/dispatch.controller";
import { TransportJobsService } from "./jobs/transport-jobs.service";
import { JobMessageImportService } from "./jobs/message-import/job-message-import.service";
import { DriverJobsService } from "./driver-app/driver-jobs.service";
import { DispatchService } from "./dispatch/dispatch.service";
import { FinanceModule } from "./finance/finance.module";
import { DriversModule } from "./drivers/drivers.module";
import {
  JOB_MESSAGE_PARSER_TOKEN,
} from "./jobs/message-import/job-message-import.constants";
import { FakeJobMessageParser } from "./jobs/message-import/fake-job-message-parser";
import { OpenAIJobMessageParser } from "./jobs/message-import/openai-job-message-parser";

@Module({
  imports: [PrismaModule, AuthModule, AuditModule, FinanceModule, DriversModule],
  controllers: [
    TransportJobsController,
    TransportTripsController,
    DriverJobsController,
    DriverHomeController,
    DriverTripsController,
    DispatchController,
  ],
  providers: [
    TransportJobsService,
    DriverJobsService,
    DispatchService,
    JobMessageImportService,
    {
      provide: JOB_MESSAGE_PARSER_TOKEN,
      useFactory: () => {
        // Deterministic fake for tests.
        const useFake =
          process.env.JOB_MESSAGE_IMPORT_PARSER === "FAKE" ||
          process.env.NODE_ENV === "test" ||
          !process.env.OPENAI_API_KEY;

        if (useFake) {
          return new FakeJobMessageParser();
        }

        const apiKey = process.env.OPENAI_API_KEY;
        const model = process.env.OPENAI_JOB_IMPORT_MODEL ?? "gpt-4.1-mini";
        if (!apiKey) {
          throw new Error("OPENAI_API_KEY is required for job message import");
        }
        return new OpenAIJobMessageParser({ apiKey, model });
      },
    },
  ],
})
export class TransportExecutionModule {}
