import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '@/auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { MasterModule } from '../master/master.module';
import { CustomerCompanyDocumentsController } from './customer-company-documents.controller';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [AuthModule, PrismaModule, AuditModule, MasterModule],
  controllers: [CustomersController, CustomerCompanyDocumentsController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
