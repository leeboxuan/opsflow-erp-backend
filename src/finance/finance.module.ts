import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';

@Module({
  controllers: [FinanceController, InvoicesController],
  providers: [FinanceService, InvoicesService, PrismaService],
})
export class FinanceModule {}
