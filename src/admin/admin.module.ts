import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { AuthModule } from '../shared/auth/auth.module';
import { DriversModule } from '../transport/drivers/drivers.module';
import { TenantUserProvisioningService } from './tenant-user-provisioning.service';

@Module({
  imports: [PrismaModule, AuthModule, DriversModule],
  controllers: [AdminController],
  providers: [TenantUserProvisioningService],
  exports: [TenantUserProvisioningService],
})
export class AdminModule {}
