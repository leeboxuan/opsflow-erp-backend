import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { AuthModule } from '@/shared/auth/auth.module';

@Module({
  imports: [AuthModule,PrismaModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
