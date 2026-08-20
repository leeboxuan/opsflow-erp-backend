import { Module } from "@nestjs/common";
import { PrismaService } from "../../shared/prisma/prisma.service";

import { AuthModule } from "../../shared/auth/auth.module";

import { FinanceController } from "./finance.controller";
import { FinanceService } from "./finance.service";
import { DriverIncentivesController } from "./driver-incentives.controller";
import { InvoicesController } from "./invoices.controller";
import { InvoicesService } from "./invoices.service";
import { PortalInvoicesController } from "./portal-invoices.controller";
import { TripExpensesController } from "./trip-expenses.controller";
import { TripExpensesService } from "./trip-expenses.service";
import { JobFinanceSummaryController } from "./job-finance-summary.controller";
import { JobFinanceSummaryService } from "./job-finance-summary.service";
import { AuditModule } from "../../shared/audit/audit.module";
import { DriversModule } from "../drivers/drivers.module";
import { IdempotencyModule } from "../../shared/idempotency/idempotency.module";
import { SupabaseService } from "../../shared/auth/supabase.service";

@Module({
  imports: [AuthModule, AuditModule, DriversModule, IdempotencyModule],
  controllers: [
    FinanceController,
    DriverIncentivesController,
    InvoicesController,
    PortalInvoicesController,
    TripExpensesController,
    JobFinanceSummaryController,
  ],
  providers: [
    FinanceService,
    InvoicesService,
    TripExpensesService,
    JobFinanceSummaryService,
    PrismaService,
    SupabaseService,
  ],
  exports: [InvoicesService, TripExpensesService, JobFinanceSummaryService],
})
export class FinanceModule {}
