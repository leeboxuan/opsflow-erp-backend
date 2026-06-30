import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { AuthModule } from '../shared/auth/auth.module';
import { DriverModule } from '../driver/driver.module';

@Module({
  imports: [PrismaModule, AuthModule, DriverModule],
  controllers: [AdminController],
})
export class AdminModule {}
