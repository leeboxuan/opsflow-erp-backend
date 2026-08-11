import { Module } from '@nestjs/common';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { AuthModule } from '@/shared/auth/auth.module';
import { AuditModule } from '../shared/audit/audit.module';
import { MasterModule } from '../transport/master-rates/master.module';
import { CustomerCompanyDocumentsController } from './customer-company-documents.controller';
import { CompaniesDocumentsController } from './companies-documents.controller';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { RateTemplatesController } from './rate-templates/rate-templates.controller';
import { RateTemplatesService } from './rate-templates/rate-templates.service';
import { CustomerQuotationsController } from './customer-quotations/customer-quotations.controller';
import { CustomerQuotationsService } from './customer-quotations/customer-quotations.service';

@Module({
  imports: [AuthModule, PrismaModule, AuditModule, MasterModule],
  controllers: [
    CustomersController,
    CustomerCompanyDocumentsController,
    CompaniesDocumentsController,
    RateTemplatesController,
    CustomerQuotationsController,
  ],
  providers: [CustomersService, RateTemplatesService, CustomerQuotationsService],
  exports: [CustomersService, RateTemplatesService, CustomerQuotationsService],
})
export class CustomersModule {}
