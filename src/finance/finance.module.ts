import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

import { AuthModule } from "../auth/auth.module";

import { FinanceController } from "./finance.controller";
import { FinanceService } from "./finance.service";

import { InvoicesController } from "./invoices.controller";
import { InvoicesService } from "./invoices.service";
import { PortalInvoicesController } from "./portal-invoices.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [FinanceController, InvoicesController, PortalInvoicesController],
  providers: [FinanceService, InvoicesService, PrismaService],
})
export class FinanceModule {}
