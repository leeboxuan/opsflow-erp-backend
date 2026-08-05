import { Module } from "@nestjs/common";
import { AuthModule } from "../shared/auth/auth.module";
import { PrismaModule } from "../shared/prisma/prisma.module";
import { StatisticsDriversController } from "./statistics-drivers.controller";
import { StatisticsDriversService } from "./statistics-drivers.service";
import { StatisticsExceptionsController } from "./statistics-exceptions.controller";
import { StatisticsExceptionsService } from "./statistics-exceptions.service";
import { StatisticsExportController } from "./statistics-export.controller";
import { StatisticsExportService } from "./statistics-export.service";
import { StatisticsFinanceController } from "./statistics-finance.controller";
import { StatisticsFinanceService } from "./statistics-finance.service";
import { StatisticsOverviewController } from "./statistics-overview.controller";
import { StatisticsOverviewService } from "./statistics-overview.service";

/**
 * Dedicated Statistics V1 module boundary.
 *
 * Only truthful, implemented surfaces are registered. The WP2 contract
 * controller remains unregistered until its remaining routes gain real
 * services.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [
    StatisticsOverviewController,
    StatisticsDriversController,
    StatisticsFinanceController,
    StatisticsExceptionsController,
    StatisticsExportController,
  ],
  providers: [
    StatisticsOverviewService,
    StatisticsDriversService,
    StatisticsFinanceService,
    StatisticsExceptionsService,
    StatisticsExportService,
  ],
})
export class StatisticsModule {}
