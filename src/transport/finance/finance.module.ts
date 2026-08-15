import { Module } from "@nestjs/common";
import { PrismaService } from "../../shared/prisma/prisma.service";

import { AuthModule } from "../../shared/auth/auth.module";

import { FinanceController } from "./finance.controller";
import { FinanceService } from "./finance.service";
import { DriverIncentivesController } from "./driver-incentives.controller";
import { InvoicesController } from "./invoices.controller";
import { InvoicesService } from "./invoices.service";
import { PortalInvoicesController } from "./portal-invoices.controller";
import { AuditModule } from "../../shared/audit/audit.module";
import { DriversModule } from "../drivers/drivers.module";

@Module({
  imports: [AuthModule, AuditModule, DriversModule],
  controllers: [
    FinanceController,
    DriverIncentivesController,
    InvoicesController,
    PortalInvoicesController,
  ],
  providers: [FinanceService, InvoicesService, PrismaService],
  exports: [InvoicesService],
})
export class FinanceModule {}
