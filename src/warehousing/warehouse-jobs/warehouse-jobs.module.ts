import { Module } from '@nestjs/common';
import { AuthModule } from '../../shared/auth/auth.module';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { WarehouseJobsController } from './warehouse-jobs.controller';
import { WarehouseJobsService } from './warehouse-jobs.service';
import { WarehouseJobLifecycleService } from './warehouse-job-lifecycle.service';
import { WarehouseJobLinesService } from './warehouse-job-lines.service';
import { WarehouseJobUnitsService } from './warehouse-job-units.service';
import { WarehouseJobEventsService } from './warehouse-job-events.service';
import { WarehouseInventoryBridgeService } from './warehouse-inventory-bridge.service';
import { WarehouseJobDocumentsService } from './warehouse-job-documents.service';
import { WarehouseJobReportPreviewService } from './warehouse-job-report-preview.service';
import { WarehouseJobCargoLinesService } from './warehouse-job-cargo-lines.service';
import { WarehouseJobContainersService } from './warehouse-job-containers.service';
import { WarehouseJobDeliveryOrderService } from './warehouse-job-delivery-order.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [WarehouseJobsController],
  providers: [
    WarehouseJobsService,
    WarehouseJobLifecycleService,
    WarehouseJobLinesService,
    WarehouseJobUnitsService,
    WarehouseJobEventsService,
    WarehouseInventoryBridgeService,
    WarehouseJobDocumentsService,
    WarehouseJobReportPreviewService,
    WarehouseJobCargoLinesService,
    WarehouseJobContainersService,
    WarehouseJobDeliveryOrderService,
  ],
  exports: [WarehouseJobsService],
})
export class WarehouseJobsModule {}
