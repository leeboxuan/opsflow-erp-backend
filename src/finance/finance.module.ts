import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

import { AuthModule } from "../auth/auth.module";

import { FinanceController } from "./finance.controller";
import { FinanceService } from "./finance.service";

import { InvoicesController } from "./invoices.controller";
import { InvoicesService } from "./invoices.service";

@Module({
  imports: [AuthModule],
  controllers: [FinanceController, InvoicesController],
  providers: [FinanceService, InvoicesService, PrismaService],
})
export class FinanceModule {}
