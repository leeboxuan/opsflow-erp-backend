import { Module } from '@nestjs/common';
import { DriversController } from './drivers.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [DriversController],
})
export class DriversModule {}
